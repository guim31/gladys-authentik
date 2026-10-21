// -----------------------------------------------------------------------------
// authentik API v3 client, checked against authentik 2026.8.4. Every request
// sends the API token of a service account (`Authorization: Bearer …`):
//
//   GET /api/v3/events/events/?actions=login&actions=login_failed…
//       &ordering=-created&page_size=100&page=N    the security events, latest
//                                                  first (no date filter exists:
//                                                  the pages are read until an
//                                                  event already seen)
//   GET /api/v3/core/users/?is_active=true&type=internal&type=external
//       &page_size=1                               pagination.count = the users
//   GET /api/v3/admin/version/                     version_current, outdated
//                                                  (no permission needed)
//   GET /api/v3/outposts/instances/                the outposts
//   GET /api/v3/outposts/instances/{uuid}/health/  one entry per connected
//                                                  instance, [] when none
//
// An event is { pk, user: { pk, username }, action, app, context, client_ip,
// created }. `context.geo` ({ country, city, … }) only exists when GeoIP is
// set up in authentik; a failed login names the typed user in
// `context.username` (and in `user.username`, even for an unknown account).
//
// Permissions of the service account (a role): authentik_events.view_event,
// authentik_core.view_user, authentik_outposts.view_outpost. The token must
// have the "API" intent: the one `service_account/` creates is an app
// password, refused by the API (403 "Token invalid/expired").
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // the token is refused (401)
  FORBIDDEN: 'forbidden', // the token lacks a permission (403)
  NOT_AUTHENTIK: 'not_authentik', // something answers, not the authentik API
  HTTP: 'http', // any other HTTP error
});

export class AuthentikError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'AuthentikError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_NOT_YET_VALID',
  // https:// on a plain HTTP port (authentik's 9000).
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_PACKET_LENGTH_TOO_LONG',
  'EPROTO',
]);

// A page of 100 events with their HTTP context stays far below this.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

// The events the integration follows: the others (flows, policies, models)
// are not security news and would only cost pages.
export const SECURITY_ACTIONS = Object.freeze([
  'login',
  'login_failed',
  'suspicious_request',
  'password_set',
  'impersonation_started',
]);

export const PAGE_SIZE = 100;

const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch {
    return '0';
  }
})();
export const USER_AGENT = `gladys-authentik/${VERSION}`;

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory authentik
 * (test/helpers/fakeAuthentik.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(url, { method = 'GET', headers = {}, timeoutMs = 15_000 }) {
  const response = await fetch(url, {
    method,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      await response.body.cancel().catch(() => {});
      throw new Error('Response too large');
    }
    chunks.push(chunk);
  }
  return { status: response.status, body: Buffer.concat(chunks).toString('utf8') };
}

const str = (value, max = 255) => (typeof value === 'string' ? value.slice(0, max) : '');
const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

/**
 * An event, kept small (no HTTP context); null when unusable.
 * @returns {{ pk: string, action: string, created: number, username: string,
 *   ip: string, country: string, city: string, message: string }|null}
 */
export function normalizeEvent(raw) {
  if (!raw || typeof raw !== 'object' || typeof raw.pk !== 'string') {
    return null;
  }
  const created = Date.parse(raw.created);
  if (!Number.isFinite(created)) {
    return null;
  }
  const context = object(raw.context);
  const geo = object(context.geo);
  const user = object(raw.user);
  // A failed login: the typed name is in the context (and in `user`, even for
  // an unknown account). The other events name their user, the administrator
  // for an impersonation.
  const typed = str(context.username, 150);
  const named = str(user.username, 150);
  const username = raw.action === 'login_failed' ? typed || named : named || typed;
  return {
    pk: raw.pk,
    action: str(raw.action, 64),
    created,
    username: username === 'AnonymousUser' ? '' : username,
    ip: str(raw.client_ip, 64),
    country: /^[A-Za-z]{2}$/.test(geo.country ?? '') ? geo.country.toUpperCase() : '',
    city: str(geo.city, 128),
    message: str(context.message, 200),
  };
}

/** One outpost and whether an instance of it is connected. */
export function normalizeOutpost(raw, health) {
  const instances = Array.isArray(health) ? health : [];
  return {
    id: str(raw.pk, 64),
    name: str(raw.name, 128),
    type: str(raw.type, 32),
    instances: instances.length,
    version: str(instances[0]?.version, 32),
  };
}

export class AuthentikClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL (src/config.js parseServerUrl)
   * @param {string} options.token API token
   * @param {Function} [options.request] HTTP seam, httpRequest by default
   */
  constructor({ url, token, request = httpRequest }) {
    this.url = url;
    this.token = token;
    this.request = request;
  }

  /**
   * GET a path of the API, parsed.
   * @throws {AuthentikError}
   */
  async get(path) {
    let response;
    try {
      response = await this.request(`${this.url}/api/v3${path}`, {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
      });
    } catch (err) {
      if (err?.message === 'Response too large') {
        throw new AuthentikError(ERROR_KINDS.HTTP, `Answer too large on ${path.split('?')[0]}`);
      }
      const code = err?.cause?.code ?? err?.code;
      if (TLS_CODES.has(code)) {
        throw new AuthentikError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new AuthentikError(
        ERROR_KINDS.UNREACHABLE,
        `No answer from authentik (${code ?? err?.name ?? 'error'})`,
      );
    }
    const { status, body } = response;
    if (status === 401) {
      throw new AuthentikError(ERROR_KINDS.AUTH, 'API token refused (HTTP 401)', { status });
    }
    // An unknown, expired or non-API token is a 403 too ("Token
    // invalid/expired"), not a 401.
    if (status === 403 && /token invalid/i.test(body)) {
      throw new AuthentikError(ERROR_KINDS.AUTH, 'API token refused (invalid or expired)', {
        status,
      });
    }
    if (status === 403) {
      throw new AuthentikError(
        ERROR_KINDS.FORBIDDEN,
        `Permission missing for ${path.split('?')[0]}`,
        {
          status,
        },
      );
    }
    if (status === 404 || (status >= 300 && status < 400)) {
      throw new AuthentikError(
        ERROR_KINDS.NOT_AUTHENTIK,
        `No authentik API here (HTTP ${status})`,
        {
          status,
        },
      );
    }
    if (status < 200 || status >= 300) {
      throw new AuthentikError(ERROR_KINDS.HTTP, `HTTP ${status} on ${path.split('?')[0]}`, {
        status,
      });
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new AuthentikError(
        ERROR_KINDS.NOT_AUTHENTIK,
        'The answer is not JSON (not authentik?)',
        {
          status,
        },
      );
    }
  }

  /** A paginated list: { results, next } (next = 0 on the last page). */
  async page(path) {
    const data = object(await this.get(path));
    if (!Array.isArray(data.results)) {
      throw new AuthentikError(ERROR_KINDS.NOT_AUTHENTIK, 'Unexpected answer (no results)');
    }
    const pagination = object(data.pagination);
    return {
      results: data.results,
      next: Number.isInteger(pagination.next) ? pagination.next : 0,
      count: Number.isInteger(pagination.count) ? pagination.count : data.results.length,
    };
  }

  /**
   * The security events, latest first, page after page until `stop(event)`
   * says an event is old enough, or `maxPages` pages.
   * @param {(event: object) => boolean} stop
   * @returns {Promise<{ events: object[], complete: boolean }>} complete:
   *   false when `maxPages` cut the reading short
   */
  async securityEvents(stop, maxPages) {
    const actions = SECURITY_ACTIONS.map((action) => `actions=${action}`).join('&');
    const events = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const { results, next } = await this.page(
        `/events/events/?${actions}&ordering=-created&page_size=${PAGE_SIZE}&page=${page}`,
      );
      for (const raw of results) {
        const event = normalizeEvent(raw);
        if (!event) {
          continue;
        }
        if (stop(event)) {
          return { events, complete: true };
        }
        events.push(event);
      }
      if (!next) {
        return { events, complete: true };
      }
    }
    return { events, complete: false };
  }

  /** Active human accounts (service accounts left out). */
  async userCount() {
    const { count } = await this.page(
      '/core/users/?is_active=true&type=internal&type=external&page_size=1',
    );
    return count;
  }

  /** { current, outdated } of the server. */
  async version() {
    const data = object(await this.get('/admin/version/'));
    return {
      current: str(data.version_current, 32),
      outdated: data.outdated === true && data.version_latest_valid !== false,
    };
  }

  /** Every outpost with its connected instances. */
  async outposts() {
    const outposts = [];
    for (let page = 1; page <= 10; page += 1) {
      const { results, next } = await this.page(`/outposts/instances/?page_size=100&page=${page}`);
      for (const raw of results) {
        if (!raw || typeof raw.pk !== 'string') {
          continue;
        }
        let health;
        try {
          health = await this.get(`/outposts/instances/${encodeURIComponent(raw.pk)}/health/`);
        } catch (err) {
          // Deleted between the list and its health: skipped.
          if (err instanceof AuthentikError && err.status === 404) {
            continue;
          }
          throw err;
        }
        outposts.push(normalizeOutpost(raw, health));
      }
      if (!next) {
        break;
      }
    }
    return outposts;
  }
}

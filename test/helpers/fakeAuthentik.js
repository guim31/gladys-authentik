// -----------------------------------------------------------------------------
// An in-memory authentik API v3, built on the answers of a real authentik
// 2026.8.4 (test/fixtures/authentik, recorded on 20/10/2026 with the MaxMind
// GeoIP test databases): its `request` replaces the network seam of the
// client. Events can be added, outposts disconnected, endpoints refused.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const read = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/authentik/${name}`, import.meta.url), 'utf8'));

export const FIXTURES = {
  events: read('events.json'),
  outposts: read('outposts.json'),
  healthEmbedded: read('health-embedded.json'),
  healthLdap: read('health-ldap.json'),
  version: read('version.json'),
  users: read('users.json'),
};

export const BASE = 'https://auth.example.com';
export const API_TOKEN = 'test-token-not-a-secret';
export const EMBEDDED = '48ed69f1-c7dc-469a-bfb1-01931d619b5a';
export const LDAP = '60d219e0-b795-4fa3-8caa-4e5323734c08';

const json = (status, data) => ({ status, body: JSON.stringify(data) });

export class FakeAuthentik {
  constructor({ events = FIXTURES.events.results } = {}) {
    this.events = structuredClone(events);
    this.outposts = structuredClone(FIXTURES.outposts.results);
    this.health = new Map([
      [EMBEDDED, structuredClone(FIXTURES.healthEmbedded)],
      [LDAP, structuredClone(FIXTURES.healthLdap)],
    ]);
    this.userCount = FIXTURES.users.pagination.count;
    this.down = false;
    /** @type {Set<string>} path prefixes answered 403 (a permission missing) */
    this.forbidden = new Set();
    this.requests = [];
    this.request = this.request.bind(this);
  }

  /** A new event, like the ones authentik writes; returns it. */
  add(action, { username = 'alice', ip = '198.51.100.20', geo, at, context = {} } = {}) {
    const event = {
      pk: randomUUID(),
      user: { pk: 5, email: `${username}@example.com`, username },
      action,
      app: 'authentik.events.signals',
      context: {
        ...(geo ? { geo } : {}),
        ...(action === 'login_failed' ? { username } : {}),
        ...context,
      },
      client_ip: ip,
      created: new Date(at).toISOString(),
      expires: new Date(at + 365 * 86_400_000).toISOString(),
    };
    this.events.push(event);
    return event;
  }

  setOnline(uuid, online) {
    this.health.set(uuid, online ? structuredClone(FIXTURES.healthEmbedded) : []);
  }

  async request(url, { headers = {} } = {}) {
    this.requests.push(url);
    if (this.down) {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    }
    const parsed = new URL(url);
    if (!parsed.href.startsWith(`${BASE}/api/v3/`)) {
      return { status: 404, body: 'Not Found' };
    }
    if (headers.Authorization !== `Bearer ${API_TOKEN}`) {
      return json(403, { detail: 'Token invalid/expired' });
    }
    const path = parsed.pathname.slice(
      `${new URL(BASE).pathname.replace(/\/$/, '')}/api/v3`.length,
    );
    if ([...this.forbidden].some((prefix) => path.startsWith(prefix))) {
      return json(403, { detail: 'You do not have permission to perform this action.' });
    }
    const query = parsed.searchParams;
    if (path === '/events/events/') {
      const actions = query.getAll('actions');
      const sorted = this.events
        .filter((event) => actions.length === 0 || actions.includes(event.action))
        .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
      const size = Number(query.get('page_size') ?? 20);
      const page = Number(query.get('page') ?? 1);
      const results = sorted.slice((page - 1) * size, page * size);
      return json(200, {
        pagination: {
          next: page * size < sorted.length ? page + 1 : 0,
          previous: page > 1 ? page - 1 : 0,
          count: sorted.length,
          current: page,
          total_pages: Math.ceil(sorted.length / size),
        },
        results,
        autocomplete: {},
      });
    }
    if (path === '/core/users/') {
      return json(200, {
        pagination: { ...FIXTURES.users.pagination, count: this.userCount },
        results: FIXTURES.users.results,
      });
    }
    if (path === '/admin/version/') {
      return json(200, FIXTURES.version);
    }
    if (path === '/outposts/instances/') {
      return json(200, {
        pagination: { ...FIXTURES.outposts.pagination, count: this.outposts.length },
        results: this.outposts,
      });
    }
    const health = path.match(/^\/outposts\/instances\/([^/]+)\/health\/$/);
    if (health && this.health.has(health[1])) {
      return json(200, this.health.get(health[1]));
    }
    return json(404, { detail: 'Not found.' });
  }
}

// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// One authentik server: its address and an API token (a service account with
// read permissions), the rule of the "series of failed logins" trigger, the
// usual countries of the users.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

// Windows of the "series of failed logins" trigger, in minutes.
export const BURST_WINDOWS = ['5', '10', '15', '30', '60'];

export const BURST_MIN = 2;
export const BURST_MAX = 100;

export const DEFAULT_CONFIG = {
  url: '',
  api_token: '',
  burst_count: 5,
  burst_window: '10',
  usual_countries: '',
  poll_interval: '60',
  language: 'fr',
};

/**
 * Parse the address typed by the user into a base URL: a bare host or IP
 * (`auth.example.com`, HTTPS by default, the usual way authentik is reached)
 * or a full URL. A trailing `/api/v3` or `/if/admin` (copied from the browser)
 * is dropped, any other path kept (authentik behind a sub-path).
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host[:port][/path]`, null when unusable
 */
export function parseServerUrl(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs.
  if (url.username || url.password) {
    return null;
  }
  const path = url.pathname
    .replace(/\/+$/, '')
    .replace(/\/(api\/v3|if\/[a-z]+)(\/.*)?$/i, '')
    .replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** Host part shown to the user (no scheme). */
export const hostOf = (url) => url.replace(/^https?:\/\//, '');

/**
 * "FR, be ;DE" → ['FR', 'BE', 'DE']: ISO 3166 alpha-2 codes, as authentik's
 * GeoIP reports them. Anything else is ignored.
 */
export function parseCountries(raw) {
  if (typeof raw !== 'string') {
    return [];
  }
  const codes = raw
    .toUpperCase()
    .split(/[\s,;]+/)
    .filter((code) => /^[A-Z]{2}$/.test(code));
  return [...new Set(codes)];
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const typed = text('url');
  const choice = (key, list) =>
    list.includes(String(source[key])) ? String(source[key]) : DEFAULT_CONFIG[key];
  const count = Number(source.burst_count);
  return {
    // '' when nothing was typed yet, null when what was typed is unusable.
    url: typed ? parseServerUrl(typed) : '',
    apiToken: text('api_token'),
    burstCount:
      Number.isInteger(count) && count >= BURST_MIN && count <= BURST_MAX
        ? count
        : DEFAULT_CONFIG.burst_count,
    burstWindowMs: Number(choice('burst_window', BURST_WINDOWS)) * 60_000,
    usualCountries: parseCountries(source.usual_countries),
    pollIntervalMs: Number(choice('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

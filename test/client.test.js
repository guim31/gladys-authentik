// -----------------------------------------------------------------------------
// The authentik client and the configuration parsers, on the real answers of
// authentik 2026.8.4 (test/fixtures/authentik).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseCountries, parseServerUrl } from '../src/config.js';
import {
  AuthentikClient,
  ERROR_KINDS,
  USER_AGENT,
  normalizeEvent,
} from '../src/authentik/client.js';
import { API_TOKEN, BASE, FIXTURES, FakeAuthentik } from './helpers/fakeAuthentik.js';

test('the real events are normalized: typed user, address, GeoIP country and city', () => {
  const events = FIXTURES.events.results.map(normalizeEvent);
  assert.ok(events.every(Boolean));
  const [aliceLogin, , adminLogin, unknownFailure, adminFailure] = events;
  assert.deepEqual(
    { ...aliceLogin, pk: undefined, created: undefined },
    {
      pk: undefined,
      action: 'login',
      created: undefined,
      username: 'alice',
      ip: '81.2.69.142',
      country: 'GB',
      city: 'London',
      message: '',
    },
  );
  assert.equal(adminLogin.country, 'SE');
  assert.equal(unknownFailure.username, 'nosuchuser');
  assert.equal(adminFailure.username, 'akadmin');
  assert.equal(normalizeEvent({ pk: 1 }), null);
  assert.equal(normalizeEvent({ pk: 'x', created: 'never' }), null);
});

test('the address typed by the user', () => {
  assert.equal(parseServerUrl('auth.example.com'), 'https://auth.example.com');
  assert.equal(parseServerUrl('http://192.0.2.10:9000/'), 'http://192.0.2.10:9000');
  assert.equal(parseServerUrl('192.0.2.10:9000'), 'http://192.0.2.10:9000');
  assert.equal(parseServerUrl('192.0.2.10:9443'), 'https://192.0.2.10:9443');
  assert.equal(
    parseServerUrl('https://auth.example.com/if/admin/#/events'),
    'https://auth.example.com',
  );
  assert.equal(parseServerUrl('https://example.com/sso/api/v3/'), 'https://example.com/sso');
  assert.equal(parseServerUrl('https://user:pass@auth.example.com'), null);
  assert.equal(parseServerUrl('ftp://auth.example.com'), null);
  assert.equal(parseServerUrl('   '), null);
});

test('the usual countries and the other settings are normalized', () => {
  assert.deepEqual(parseCountries('fr, BE;de  fr xyz 1'), ['FR', 'BE', 'DE']);
  const config = normalizeConfig({ burst_count: 1, burst_window: '7', poll_interval: '300' });
  assert.equal(config.burstCount, 5);
  assert.equal(config.burstWindowMs, 600_000);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ burst_count: 20 }).burstCount, 20);
});

test('every request carries the token and a User-Agent; pages are read until told to stop', async () => {
  const fake = new FakeAuthentik();
  const seen = [];
  const client = new AuthentikClient({
    url: BASE,
    token: API_TOKEN,
    request: (url, options) => {
      seen.push(options.headers);
      return fake.request(url, options);
    },
  });
  const { events, complete } = await client.securityEvents(
    (event) => event.action === 'password_set',
    5,
  );
  assert.equal(complete, true);
  assert.deepEqual(
    events.map((event) => event.action),
    ['login'],
  );
  assert.equal(seen[0].Authorization, `Bearer ${API_TOKEN}`);
  assert.equal(seen[0]['User-Agent'], USER_AGENT);
  assert.equal(await client.userCount(), 2);
  assert.deepEqual(await client.version(), { current: '2026.8.4', outdated: false });
  const outposts = await client.outposts();
  assert.deepEqual(
    outposts.map((outpost) => [outpost.name, outpost.type, outpost.instances]),
    [
      ['LDAP outpost', 'ldap', 0],
      ['authentik Embedded Outpost', 'proxy', 1],
    ],
  );
});

test('errors are sorted by kind, never with the token in the message', async () => {
  const kindOf = async (request, token = API_TOKEN) => {
    try {
      await new AuthentikClient({ url: BASE, token, request }).version();
      return 'ok';
    } catch (err) {
      assert.ok(!err.message.includes(token), 'no token in the message');
      return err.kind;
    }
  };
  const fake = new FakeAuthentik();
  // authentik answers 403 "Token invalid/expired" to a wrong token.
  assert.equal(await kindOf(fake.request, 'wrong-token'), ERROR_KINDS.AUTH);
  assert.equal(await kindOf(async () => ({ status: 401, body: '' })), ERROR_KINDS.AUTH);
  assert.equal(
    await kindOf(async () => ({ status: 403, body: '{"detail":"You do not have permission"}' })),
    ERROR_KINDS.FORBIDDEN,
  );
  assert.equal(await kindOf(async () => ({ status: 404, body: '' })), ERROR_KINDS.NOT_AUTHENTIK);
  assert.equal(await kindOf(async () => ({ status: 302, body: '' })), ERROR_KINDS.NOT_AUTHENTIK);
  assert.equal(
    await kindOf(async () => ({ status: 200, body: '<html>' })),
    ERROR_KINDS.NOT_AUTHENTIK,
  );
  assert.equal(await kindOf(async () => ({ status: 500, body: '' })), ERROR_KINDS.HTTP);
  const tls = Object.assign(new TypeError('fetch failed'), {
    cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
  });
  assert.equal(
    await kindOf(async () => {
      throw tls;
    }),
    ERROR_KINDS.TLS,
  );
  fake.down = true;
  assert.equal(await kindOf(fake.request), ERROR_KINDS.UNREACHABLE);
});

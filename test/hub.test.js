// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake authentik built on real
// answers: discovery, states, the scene events of each trigger, persistence
// across restarts, errors and partial failures, quiet logs, the widget, the
// scene action and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { KEYS } from '../src/devices.js';
import { MAX_EVENTS_PER_READ, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { ACTIONS } from '../src/widgets.js';
import {
  FakeAuthentik,
  LDAP,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const state = (world, key) => world.fake.lastState(idsOf(world).feature(key));
const GB = { country: 'GB', city: 'London' };
const US = { country: 'US', city: 'Milton' };

/** A read one minute later, with what `fn` added to authentik meanwhile. */
async function later(world, fn = () => {}) {
  world.clock.advance(60_000);
  fn(world.clock.time - 30_000);
  await world.hub.pollNow();
}

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('one authentik device in Discovery, nothing announced at the first read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const [device] = world.fake.discoveredDevices;
  assert.equal(device.name, 'authentik');
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').pop()),
    Object.values(KEYS),
  );
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.sceneEvents.length, 0, 'what is already there is not news');
  // The LDAP outpost of the fixtures has no instance: offline from the start.
  await later(world);
  await later(world);
  assert.equal(events(world, TRIGGERS.OUTPOST_OFFLINE).length, 0);
});

test('the states at once when the device is added, then only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.equal(world.fake.states.length, 0, 'nothing published before the device is added');
  await createDevices(world);
  assert.equal(state(world, KEYS.REACHABLE), 1);
  assert.equal(state(world, KEYS.FAILED_1H), 3);
  assert.equal(state(world, KEYS.FAILED_24H), 3);
  assert.equal(state(world, KEYS.LOGINS_24H), 2);
  assert.equal(state(world, KEYS.USERS), 2);
  assert.equal(state(world, KEYS.OUTPOSTS_ONLINE), 1);
  assert.equal(state(world, KEYS.OUTPOSTS_TOTAL), 2);
  assert.equal(state(world, KEYS.VERSION), '2026.8.4');
  assert.deepEqual(
    world.fake.transports.map((e) => e.transport),
    ['local'],
  );
  assert.ok(world.fake.widgetRefreshes.length > 0);

  const before = world.fake.states.length;
  await later(world);
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');
  await later(world, (at) => world.authentik.add('login_failed', { at, geo: US }));
  assert.equal(state(world, KEYS.FAILED_1H), 4);
  assert.equal(state(world, KEYS.FAILED_24H), 4);
});

test('a failed login fires "Failed login" with the user, the address and the country', async (t) => {
  const world = await createWorld({ clock: createClock(Date.UTC(2026, 9, 20, 22, 10)) });
  t.after(() => world.app.stop());
  await later(world, (at) =>
    world.authentik.add('login_failed', { username: 'bob', ip: '198.51.100.7', geo: US, at }),
  );
  assert.deepEqual(events(world, TRIGGERS.LOGIN_FAILED), [
    {
      key: TRIGGERS.LOGIN_FAILED,
      data: { username: 'bob', ip: '198.51.100.7', country: 'US', city: 'Milton' },
    },
  ]);
  await later(world);
  assert.equal(events(world, TRIGGERS.LOGIN_FAILED).length, 1, 'once');
});

test('the real failed login of an unknown user names the typed user', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const unknown = world.hub.latestEvents().find((event) => event.ip === '216.160.83.56');
  assert.equal(unknown.username, 'nosuchuser');
  assert.equal(unknown.country, 'US');
  assert.equal(unknown.city, 'Milton');
});

test('a series of failed logins fires once, then again only after a calm', async (t) => {
  const world = await createWorld({ config: { burst_count: 3, burst_window: '5' } });
  t.after(() => world.app.stop());
  const fail = (ip) => (at) => world.authentik.add('login_failed', { at, ip, geo: US });
  await later(world, fail('198.51.100.1'));
  await later(world, fail('198.51.100.2'));
  assert.equal(events(world, TRIGGERS.LOGIN_FAILURES_BURST).length, 0);
  await later(world, (at) => {
    fail('198.51.100.3')(at);
    world.authentik.add('login_failed', { at: at + 1, ip: '198.51.100.3', username: 'root' });
  });
  const [burst] = events(world, TRIGGERS.LOGIN_FAILURES_BURST);
  assert.deepEqual(burst.data, {
    count: 4,
    window_minutes: 5,
    usernames: 2,
    addresses: 3,
    username: 'root',
    ip: '198.51.100.3',
    country: '',
  });
  await later(world, fail('198.51.100.4'));
  assert.equal(events(world, TRIGGERS.LOGIN_FAILURES_BURST).length, 1, 'same series');
  for (let i = 0; i < 6; i += 1) {
    await later(world);
  }
  await later(world, fail('198.51.100.5'));
  await later(world, fail('198.51.100.5'));
  await later(world, fail('198.51.100.5'));
  assert.equal(events(world, TRIGGERS.LOGIN_FAILURES_BURST).length, 2, 'a new series');
});

test('a login from a new country is unusual once the countries are learned', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  // Learned from the fixtures: SE (akadmin) and GB (alice).
  assert.deepEqual(Object.keys(world.hub.saved.countries).sort(), ['GB', 'SE']);
  await later(world, (at) => world.authentik.add('login', { at, username: 'alice', geo: GB }));
  assert.equal(events(world, TRIGGERS.LOGIN_UNUSUAL_COUNTRY).length, 0);
  await later(world, (at) =>
    world.authentik.add('login', { at, username: 'alice', ip: '198.51.100.9', geo: US }),
  );
  assert.deepEqual(events(world, TRIGGERS.LOGIN_UNUSUAL_COUNTRY), [
    {
      key: TRIGGERS.LOGIN_UNUSUAL_COUNTRY,
      data: { username: 'alice', ip: '198.51.100.9', country: 'US', city: 'Milton' },
    },
  ]);
  await later(world, (at) => world.authentik.add('login', { at, username: 'bob', geo: US }));
  assert.equal(events(world, TRIGGERS.LOGIN_UNUSUAL_COUNTRY).length, 1, 'learned');
  // Without GeoIP, nothing to say.
  await later(world, (at) => world.authentik.add('login', { at, username: 'carol' }));
  assert.equal(events(world, TRIGGERS.LOGIN_UNUSUAL_COUNTRY).length, 1);
});

test('the usual countries of the configuration replace the learning', async (t) => {
  const world = await createWorld({ config: { usual_countries: 'fr, se;' } });
  t.after(() => world.app.stop());
  await later(world, (at) => world.authentik.add('login', { at, geo: GB }));
  await later(world, (at) => world.authentik.add('login', { at, geo: GB }));
  await later(world, (at) => world.authentik.add('login', { at, geo: { country: 'SE' } }));
  assert.deepEqual(
    events(world, TRIGGERS.LOGIN_UNUSUAL_COUNTRY).map((event) => event.data.country),
    ['GB', 'GB'],
  );
});

test('the first country ever seen is learned silently', async (t) => {
  const world = await createWorld({ authentik: new FakeAuthentik({ events: [] }) });
  t.after(() => world.app.stop());
  await later(world, (at) => world.authentik.add('login', { at, geo: GB }));
  await later(world, (at) => world.authentik.add('login', { at, geo: US }));
  assert.deepEqual(
    events(world, TRIGGERS.LOGIN_UNUSUAL_COUNTRY).map((event) => event.data.country),
    ['US'],
  );
});

test('"Security event" for a suspicious request, a password change, an impersonation', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await later(world, (at) => {
    world.authentik.add('password_set', { at, username: 'alice' });
    world.authentik.add('suspicious_request', {
      at: at + 1,
      context: { message: 'Too many requests' },
    });
    world.authentik.add('impersonation_started', { at: at + 2, username: 'akadmin' });
    world.authentik.add('model_created', { at: at + 3 }); // not followed
  });
  assert.deepEqual(
    events(world, TRIGGERS.SECURITY_EVENT).map((event) => event.data.action),
    ['password_set', 'suspicious_request', 'impersonation_started'],
  );
  assert.equal(events(world, TRIGGERS.SECURITY_EVENT)[1].data.message, 'Too many requests');
});

test('an outpost going offline is announced once, until it is back', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.authentik.setOnline(LDAP, true);
  await later(world);
  assert.equal(state(world, KEYS.OUTPOSTS_ONLINE), 2);
  world.authentik.setOnline(LDAP, false);
  await later(world);
  assert.equal(events(world, TRIGGERS.OUTPOST_OFFLINE).length, 0, 'one read is not enough');
  await later(world);
  await later(world);
  assert.deepEqual(events(world, TRIGGERS.OUTPOST_OFFLINE), [
    { key: TRIGGERS.OUTPOST_OFFLINE, data: { outpost: 'LDAP outpost', type: 'ldap' } },
  ]);
  assert.equal(state(world, KEYS.OUTPOSTS_ONLINE), 1);
  world.authentik.setOnline(LDAP, true);
  await later(world);
  world.authentik.setOnline(LDAP, false);
  await later(world);
  await later(world);
  assert.equal(events(world, TRIGGERS.OUTPOST_OFFLINE).length, 2);
});

test('a restart announces what happened meanwhile, once, and nothing twice', async (t) => {
  const clock = createClock();
  const authentik = new FakeAuthentik();
  const first = await createWorld({ clock, authentik });
  await later(first, (at) => authentik.add('login_failed', { at, username: 'bob' }));
  await first.app.stop();
  assert.equal(events(first, TRIGGERS.LOGIN_FAILED).length, 1);

  clock.advance(5 * 60_000);
  authentik.add('login_failed', { at: clock.time - 60_000, username: 'eve' });
  const second = await createWorld({ clock, authentik, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.deepEqual(
    events(second, TRIGGERS.LOGIN_FAILED).map((event) => event.data.username),
    ['eve'],
  );
  await later(second);
  assert.equal(events(second, TRIGGERS.LOGIN_FAILED).length, 1);
});

test('a brute-force attack sends at most a few scene events per read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await later(world, (at) => {
    for (let i = 0; i < 150; i += 1) {
      world.authentik.add('login_failed', { at: at + i, username: `user${i}` });
    }
  });
  assert.equal(events(world, TRIGGERS.LOGIN_FAILED).length, MAX_EVENTS_PER_READ);
  assert.equal(events(world, TRIGGERS.LOGIN_FAILURES_BURST).length, 1);
  assert.equal(world.hub.counts().failed1h, 153, 'two pages read');
});

test('a wrong token: the reason under the integration name, no device', async (t) => {
  const world = await createWorld({ config: { api_token: 'wrong' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.en, /token refused/);
  assert.equal(world.fake.discoveredDevices.length, 0);
  const report = await world.fake.action('test_connection', {});
  assert.match(report.data.message.fr, /jeton d'API refusé/);
});

test('missing configuration and unusable address are explained', async (t) => {
  const empty = await createWorld({ config: { url: '' } });
  t.after(() => empty.app.stop());
  assert.match(empty.fake.connectionStatus.message.en, /Enter the address/);
  const bad = await createWorld({ config: { url: 'ftp://nope' } });
  t.after(() => bad.app.stop());
  assert.match(bad.fake.connectionStatus.message.en, /not understood/);
  const noToken = await createWorld({ config: { api_token: '' } });
  t.after(() => noToken.app.stop());
  assert.match(noToken.fake.connectionStatus.message.en, /API token/);
});

test('authentik down: unreachable after two failed reads, back when it answers', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.authentik.down = true;
  await later(world);
  assert.equal(state(world, KEYS.REACHABLE), 1, 'a restart of authentik goes unnoticed');
  assert.equal(world.fake.connectionStatus.connected, true);
  await later(world);
  assert.equal(state(world, KEYS.REACHABLE), 0);
  assert.match(world.fake.connectionStatus.message.en, /does not answer/);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  world.authentik.down = false;
  await later(world);
  assert.equal(state(world, KEYS.REACHABLE), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('a permission left out: the rest still works, the report says what is missing', async (t) => {
  const authentik = new FakeAuthentik();
  authentik.forbidden.add('/outposts/');
  authentik.forbidden.add('/core/users/');
  const world = await createWorld({ authentik });
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(state(world, KEYS.FAILED_24H), 3);
  assert.equal(state(world, KEYS.OUTPOSTS_TOTAL), undefined);
  assert.equal(state(world, KEYS.USERS), undefined);
  const report = await world.fake.action('test_connection', {});
  assert.match(report.data.message.en, /outposts not readable/);
  assert.match(report.data.message.en, /users not readable/);

  const noEvents = new FakeAuthentik();
  noEvents.forbidden.add('/events/');
  const blocked = await createWorld({ authentik: noEvents });
  t.after(() => blocked.app.stop());
  assert.match(blocked.fake.connectionStatus.message.en, /permission missing/);
});

test('a normal reading cycle writes nothing at the info level, nor any name or address', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const lines = await captureLogs(t, 'info', async () => {
    await later(world);
    await later(world, (at) =>
      world.authentik.add('login_failed', { at, username: 'bob', ip: '198.51.100.77' }),
    );
    await later(world, (at) =>
      world.authentik.add('login', { at, username: 'bob', ip: '198.51.100.77', geo: US }),
    );
  });
  assert.deepEqual(lines, []);
  const outage = await captureLogs(t, 'info', async () => {
    world.authentik.down = true;
    await later(world);
    await later(world);
    await later(world);
  });
  assert.equal(outage.length, 2, 'one line when it fails, one when it is unreachable');
  assert.ok(!outage.some((line) => /Bearer|test-token/.test(line)), 'no token in the logs');
});

test('the widget: tiles, the latest events, the Refresh button', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.equal(ack.success, true, ack.error);
  const content = ack.data.content;
  assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
  const [failed, logins, outposts, status, button] = content.components;
  assert.equal(failed.value, 3);
  assert.equal(logins.value, 2);
  assert.equal(outposts.value, '1/2');
  assert.equal(status.items.length, 7);
  assert.equal(status.items[0].label, 'alice');
  assert.match(status.items[0].value, /^connexion · GB · /);
  assert.equal(button.action.key, ACTIONS.REFRESH);
  const refreshed = await world.fake.widgetAction(WIDGET_KEY, ACTIONS.REFRESH, {});
  assert.equal(refreshed.success, true, refreshed.error);

  const empty = await createWorld({ authentik: new FakeAuthentik({ events: [] }) });
  t.after(() => empty.app.stop());
  const nothing = await empty.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.ok(nothing.data.content.components.some((c) => /Kein Sicherheitsereignis/.test(c.text)));
});

test('"State of authentik" returns the counts and a sentence', async (t) => {
  const world = await createWorld({ config: { language: 'fr' } });
  t.after(() => world.app.stop());
  const ack = await world.fake.sceneAction('get_status', {});
  assert.equal(ack.success, true, ack.error);
  const outputs = ack.data.outputs;
  assert.equal(outputs.failed_logins_24h, 3);
  assert.equal(outputs.last_failed_username, 'nosuchuser');
  assert.equal(outputs.last_failed_ip, '216.160.83.56');
  assert.equal(
    outputs.sentence,
    'authentik : 3 échec(s) de connexion en 1 h, 3 en 24 h, 2 connexion(s) en 24 h, avant-postes en ligne : 1/2, 2 utilisateur(s).',
  );
  world.authentik.down = true;
  world.clock.advance(60_000);
  await world.hub.pollNow();
  world.clock.advance(60_000);
  const down = await world.fake.sceneAction('get_status', {});
  assert.equal(down.data.outputs.reachable, false);
});

test('the timer of the container reads authentik without onPoll', async (t) => {
  const world = await createWorld({ timers: true, config: { poll_interval: '30' } });
  t.after(() => world.app.stop());
  const before = world.authentik.requests.length;
  await new Promise((resolve) => setTimeout(resolve, 10));
  world.hub.config = { ...world.hub.config, pollIntervalMs: 20 };
  world.hub.schedulePoll();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(world.authentik.requests.length > before, 'authentik read by the timer');
});

test('another address forgets what was saved about the previous server', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  assert.ok(world.hub.saved.cursor > 0);
  await world.hub.reconfigure({
    ...world.hub.config,
    url: 'https://other.example.com',
  });
  assert.equal(world.hub.saved.cursor, 0);
  assert.equal(world.hub.events.size, 0);
});

test('a scene event Gladys refused is sent again at the next read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const publish = world.gladys.publishSceneEvent.bind(world.gladys);
  let refuse = true;
  world.gladys.publishSceneEvent = async (key, data) => {
    if (refuse) {
      throw new Error('Gladys restarting');
    }
    return publish(key, data);
  };
  await later(world, (at) => world.authentik.add('login_failed', { at, username: 'bob' }));
  assert.equal(events(world, TRIGGERS.LOGIN_FAILED).length, 0);
  refuse = false;
  await later(world);
  assert.deepEqual(
    events(world, TRIGGERS.LOGIN_FAILED).map((event) => event.data.username),
    ['bob'],
  );
  await later(world);
  assert.equal(events(world, TRIGGERS.LOGIN_FAILED).length, 1);
});

test('a series already announced is not announced again after a restart', async (t) => {
  const clock = createClock();
  const authentik = new FakeAuthentik();
  const config = { burst_count: 4, burst_window: '15' };
  const first = await createWorld({ clock, authentik, config });
  await later(first, (at) => authentik.add('login_failed', { at }));
  assert.equal(events(first, TRIGGERS.LOGIN_FAILURES_BURST).length, 1);
  await first.app.stop();
  clock.advance(60_000);
  authentik.add('login_failed', { at: clock.time - 1000 });
  const second = await createWorld({ clock, authentik, config, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(events(second, TRIGGERS.LOGIN_FAILED).length, 1, 'the failure is news');
  assert.equal(events(second, TRIGGERS.LOGIN_FAILURES_BURST).length, 0, 'the series is not');
});

test('a new outpost not deployed yet is not announced offline', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.authentik.outposts.push({ pk: 'new-outpost', name: 'RADIUS', type: 'radius' });
  world.authentik.health.set('new-outpost', []);
  await later(world);
  await later(world);
  await later(world);
  assert.equal(events(world, TRIGGERS.OUTPOST_OFFLINE).length, 0);
  // Deleted between the list and its health: skipped, the rest still read.
  world.authentik.health.delete('new-outpost');
  await later(world);
  assert.equal(world.hub.outpostCounts().total, 2);
  assert.equal(world.hub.partial.outposts, null);
});

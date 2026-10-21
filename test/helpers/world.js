// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake authentik API, a
// temporary /data and a manual clock, with the integration wired on top
// through registerHandlers. No timer runs: the tests read authentik with
// `world.hub.pollNow()`. (Adapted from guim31/gladys-crowdsec.)
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { serverIds } from '../../src/devices.js';
import { Store } from '../../src/store.js';
import { API_TOKEN, BASE, EMBEDDED, FIXTURES, FakeAuthentik, LDAP } from './fakeAuthentik.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

// The fixtures were recorded on 20/10/2026 between 22:02 and 22:09 UTC.
export function createClock(start = Date.UTC(2026, 9, 20, 22, 12, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export async function createWorld({
  clock = createClock(),
  authentik = new FakeAuthentik(),
  config = {},
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-authentik-')),
  timings = {},
  timers = false,
} = {}) {
  const gladys = createFakeGladys({
    config: {
      url: BASE,
      api_token: API_TOKEN,
      language: 'en',
      ...config,
    },
    devices,
  });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: authentik.request,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, authentik, app, hub: app.hub, clock, dataDir };
}

export const idsOf = (world) => serverIds(world.gladys);

/** Add the discovered device in Gladys, as the user would. */
export async function createDevices(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { API_TOKEN, BASE, EMBEDDED, FIXTURES, FakeAuthentik, LDAP };

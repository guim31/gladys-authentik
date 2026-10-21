// -----------------------------------------------------------------------------
// The authentik hub: the API read on a timer of the container (the interval
// chosen in the configuration); the states of the device published when they
// change, the scene events fired for each new security event, and the views
// the widget and the scene action read.
//
// Events: the security events of the last 24 hours are read at the first
// read, then, at each read, the pages newer than the latest event already
// seen (authentik has no date filter). They are kept in memory for the counts
// and the widget. The date of the latest event seen and the ids around it are
// kept in /data (src/store.js): what happened while the integration restarted
// is still announced, once, and nothing twice.
//
// Gladys never polls the device (should_poll: false): the interval goes up to
// 5 minutes, beyond the fixed list of the core scheduler, and the scene events
// must fire whether the device is added or not.
//
// User names and addresses are personal data: they go to the scene events
// (variables, for a notification) and to the widget, never to the info logs.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { buildServerDevice, serverIds, serverValues } from './devices.js';
import { AuthentikClient, AuthentikError } from './authentik/client.js';
import { hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, ERROR_TEXT, PARTIAL_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'authentik-hub' });

export const WIDGET_KEY = 'security_events';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  LOGIN_FAILED: 'login_failed',
  LOGIN_FAILURES_BURST: 'login_failures_burst',
  LOGIN_UNUSUAL_COUNTRY: 'login_unusual_country',
  OUTPOST_OFFLINE: 'outpost_offline',
  SECURITY_EVENT: 'security_event',
});

// The actions of the "Security event" trigger (its `action` filter).
export const SECURITY_EVENT_ACTIONS = Object.freeze([
  'suspicious_request',
  'password_set',
  'impersonation_started',
]);

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads authentik again when the last read is older.
  freshMs: 15_000,
  // The users and the version move slowly: read this often.
  usersMs: 10 * 60_000,
  versionMs: 3600_000,
};

export const HOUR_MS = 3600_000;
export const DAY_MS = 24 * HOUR_MS;

// Events are read again this far before the latest one seen: an event written
// a little late by another worker of authentik is not missed (the ids sort
// out the repeats).
export const OVERLAP_MS = 2 * 60_000;

// Pages of 100 events read at most: at the first read (24 hours), then at
// each read. Beyond, the counts are lower bounds.
export const FIRST_MAX_PAGES = 30;
export const MAX_PAGES = 10;

// Failed reads in a row before authentik counts as unreachable (a restart
// goes unnoticed), and before an outpost counts as offline.
export const FAILURES_BEFORE_UNREACHABLE = 2;
export const READS_BEFORE_OFFLINE = 2;

// Scene events per trigger and per read, at most: a brute-force attack must
// not send hundreds of notifications.
export const MAX_EVENTS_PER_READ = 10;

// Scene events refused by Gladys kept for the next read, at most.
export const MAX_UNSENT = 50;

// A country learned from the successful logins is forgotten after this long
// without a login from it.
export const COUNTRY_MEMORY_MS = 365 * DAY_MS;

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const finite = (value) => (Number.isFinite(value) ? value : 0);

export class AuthentikHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/authentik/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    this.resetReads();
    this.transport = null;
    this.connection = null;
    this.discovered = null;
    this.saved = emptySaved(null);
    /** @type {Array<[string, object]>} scene events Gladys refused, to send again */
    this.unsent = [];
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  /** Forget everything read from authentik (another address or token). */
  resetReads() {
    /** @type {Map<string, object>} security events of the last 24 hours, by pk */
    this.events = new Map();
    this.loaded = false;
    this.complete = true;
    this.readAt = 0;
    this.error = null;
    this.failures = 0;
    this.polling = null;
    this.burstArmed = true;
    /** @type {object[]|null} */
    this.outposts = null;
    /** @type {Map<string, number>} reads in a row without instance, by outpost */
    this.offlineReads = new Map();
    this.users = null;
    this.usersAt = 0;
    this.version = null;
    this.versionAt = 0;
    /** @type {Record<string, object|null>} errors of the secondary endpoints */
    this.partial = { outposts: null, users: null, version: null };
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = object(await this.store.load());
    const countries = {};
    for (const [code, at] of Object.entries(object(saved.countries))) {
      if (/^[A-Z]{2}$/.test(code) && Number.isFinite(at)) {
        countries[code] = at;
      }
    }
    this.saved = {
      url: typeof saved.url === 'string' ? saved.url : null,
      initialized: saved.initialized === true,
      reachable: typeof saved.reachable === 'boolean' ? saved.reachable : null,
      cursor: finite(saved.cursor),
      recent: Array.isArray(saved.recent)
        ? saved.recent.filter((pk) => typeof pk === 'string')
        : [],
      countries,
      offline: Array.isArray(saved.offline)
        ? saved.offline.filter((id) => typeof id === 'string')
        : [],
      outposts: Array.isArray(saved.outposts)
        ? saved.outposts.filter((id) => typeof id === 'string')
        : [],
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transport = null;
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.signature !== null && this.config.language !== config.language;
    this.config = config;
    const signature = JSON.stringify([config.url, config.apiToken]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client =
        config.url && config.apiToken
          ? new AuthentikClient({ url: config.url, token: config.apiToken, request: this.request })
          : null;
      // A read of the previous client in progress must not be reused.
      this.resetReads();
      this.discovered = null;
      // Another server: what was saved about the previous one means nothing.
      if (config.url && this.saved.url !== config.url) {
        this.saved = emptySaved(config.url);
        this.unsent = [];
      }
    }
    if (languageChanged) {
      this.discovered = null; // new feature names for the Discovery tab
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading authentik works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading authentik -----------------------------------------------------

  /** Read authentik now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read authentik and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    const now = this.now();
    const newest = this.newestEvent();
    // The first read goes back 24 hours; the next ones down to the latest
    // event already seen (minus the overlap).
    const limit =
      this.loaded && newest ? Math.max(newest - OVERLAP_MS, now - DAY_MS) : now - DAY_MS;
    let result;
    try {
      result = await client.securityEvents(
        (event) => event.created < limit,
        this.loaded ? MAX_PAGES : FIRST_MAX_PAGES,
      );
    } catch (err) {
      if (!(err instanceof AuthentikError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    if (client !== this.client) {
      return false;
    }
    const outposts = await this.secondary('outposts', client, () => client.outposts());
    const users =
      this.usersAt === 0 || now - this.usersAt >= this.timings.usersMs
        ? await this.secondary('users', client, () => client.userCount())
        : undefined;
    const version =
      this.versionAt === 0 || now - this.versionAt >= this.timings.versionMs
        ? await this.secondary('version', client, () => client.version())
        : undefined;
    if (client !== this.client) {
      return false;
    }
    return this.applySuccess({ ...result, outposts, users, version });
  }

  /**
   * One of the endpoints besides the events: a failure (a permission left out
   * of the role) is kept apart, the rest still counts.
   * @returns {Promise<unknown|null>} null on failure
   */
  async secondary(key, client, fn) {
    try {
      const value = await fn();
      if (client !== this.client) {
        return null; // a read of the previous client: its news are stale
      }
      if (this.partial[key]) {
        logger.info(`authentik ${key} can be read again`);
      }
      this.partial[key] = null;
      return value;
    } catch (err) {
      if (!(err instanceof AuthentikError)) {
        throw err;
      }
      if (client !== this.client) {
        return null;
      }
      if (this.partial[key]?.kind !== err.kind) {
        logger.warn(`authentik ${key}: ${err.message}`);
      }
      this.partial[key] = { kind: err.kind, message: err.message };
      return null;
    }
  }

  /** Whether authentik counts as reachable (after a few failed reads in a row). */
  get reachable() {
    return this.loaded && this.saved.reachable !== false;
  }

  /**
   * The failure to show: after FAILURES_BEFORE_UNREACHABLE reads in a row (a
   * restart of authentik goes unnoticed, as for "Reachable"), at once when
   * nothing was ever read (wrong address or token).
   */
  get failing() {
    return this.error !== null && (this.failures >= FAILURES_BEFORE_UNREACHABLE || !this.loaded);
  }

  newestEvent() {
    let newest = 0;
    for (const event of this.events.values()) {
      newest = Math.max(newest, event.created);
    }
    return newest;
  }

  async applySuccess({ events, complete, outposts, users, version }) {
    // Everything below up to the scene events is synchronous: a configuration
    // change cannot slip between the reading and the saved state it updates.
    const saved = this.saved;
    const client = this.client;
    const config = this.config;
    const now = this.now();
    const firstRead = !this.loaded;
    const initialized = saved.initialized;
    let widgetChanged = this.error !== null || firstRead;
    let dirty = saved.reachable !== true || !initialized;
    this.error = null;
    this.failures = 0;
    saved.reachable = true;
    this.readAt = now;

    if (!complete && this.complete) {
      logger.info(
        `More than ${(firstRead ? FIRST_MAX_PAGES : MAX_PAGES) * 100} security events at once: counts are lower bounds`,
      );
    }
    this.complete = complete;

    // New events: not seen yet in this process; at its first read, those
    // after the cursor saved (what happened during a restart), the ids saved
    // with it sorting out the overlap.
    const recent = new Set(saved.recent);
    const fresh = [];
    for (const event of events) {
      if (this.events.has(event.pk)) {
        continue;
      }
      this.events.set(event.pk, event);
      widgetChanged = true;
      const isNews =
        !firstRead || (event.created >= saved.cursor - OVERLAP_MS && !recent.has(event.pk));
      if (initialized && isNews) {
        fresh.push(event);
      }
    }
    for (const [pk, event] of this.events) {
      if (event.created < now - DAY_MS) {
        this.events.delete(pk);
        widgetChanged = true;
      }
    }
    this.loaded = true;
    fresh.sort((a, b) => a.created - b.created);

    // The cursor: the latest event, and the ids at most OVERLAP_MS older.
    const newest = this.newestEvent();
    if (newest > saved.cursor) {
      saved.cursor = newest;
      dirty = true;
    }
    const nextRecent = [...this.events.values()]
      .filter((event) => event.created >= saved.cursor - OVERLAP_MS)
      .map((event) => event.pk)
      .sort();
    if (JSON.stringify(nextRecent) !== JSON.stringify([...recent].sort())) {
      saved.recent = nextRecent;
      dirty = true;
    }

    const sceneEvents = [];
    const push = (key, data) => sceneEvents.push([key, data]);
    const counts = new Map();
    const capped = (key, data) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      if (count <= MAX_EVENTS_PER_READ) {
        push(key, data);
      }
    };

    // Countries not seen for a year are forgotten before the new logins.
    for (const [code, at] of Object.entries(saved.countries)) {
      if (at < now - COUNTRY_MEMORY_MS) {
        delete saved.countries[code];
        dirty = true;
      }
    }

    // Each new event, in the order it happened.
    const loginsByCountry = [...this.events.values()]
      .filter((event) => event.action === 'login' && event.country)
      .sort((a, b) => a.created - b.created);
    if (initialized) {
      for (const event of fresh) {
        const who = {
          username: event.username,
          ip: event.ip,
          country: event.country,
          city: event.city,
        };
        if (event.action === 'login_failed') {
          capped(TRIGGERS.LOGIN_FAILED, who);
        } else if (event.action === 'login' && event.country) {
          if (this.isUnusual(event.country)) {
            capped(TRIGGERS.LOGIN_UNUSUAL_COUNTRY, who);
          }
          // Learned at once: a second login from there is no news.
          dirty = this.learnCountry(event.country, event.created) || dirty;
        } else if (SECURITY_EVENT_ACTIONS.includes(event.action)) {
          capped(TRIGGERS.SECURITY_EVENT, { action: event.action, ...who, message: event.message });
        }
      }
    }
    // Countries of the logins already there (first read, a reset): learned silently.
    for (const event of loginsByCountry) {
      dirty = this.learnCountry(event.country, event.created) || dirty;
    }

    // A series of failed logins: once when the count over the window reaches
    // the threshold with a new failure, again only after it fell below.
    const windowStart = now - config.burstWindowMs;
    const inWindow = [...this.events.values()]
      .filter((event) => event.action === 'login_failed' && event.created >= windowStart)
      .sort((a, b) => a.created - b.created);
    if (firstRead) {
      // After a restart, a series already under way was announced before.
      const freshSet = new Set(fresh);
      this.burstArmed = inWindow.filter((event) => !freshSet.has(event)).length < config.burstCount;
    }
    if (inWindow.length < config.burstCount) {
      this.burstArmed = true;
    } else if (this.burstArmed && fresh.some((event) => event.action === 'login_failed')) {
      this.burstArmed = false;
      const last = inWindow[inWindow.length - 1];
      push(TRIGGERS.LOGIN_FAILURES_BURST, {
        count: inWindow.length,
        window_minutes: config.burstWindowMs / 60_000,
        usernames: new Set(inWindow.map((event) => event.username)).size,
        addresses: new Set(inWindow.map((event) => event.ip)).size,
        username: last.username,
        ip: last.ip,
        country: last.country,
      });
    }

    // Outposts: offline after READS_BEFORE_OFFLINE reads in a row without a
    // connected instance; announced once, until it is back.
    if (outposts) {
      const before = JSON.stringify(this.outposts);
      const offline = new Set(saved.offline);
      const seen = new Set(saved.outposts);
      const known = new Set();
      for (const outpost of outposts) {
        known.add(outpost.id);
        if (outpost.instances > 0) {
          this.offlineReads.delete(outpost.id);
          if (offline.delete(outpost.id)) {
            logger.info(`Outpost ${outpost.name} is back online`);
          }
          continue;
        }
        if (!seen.has(outpost.id)) {
          // Offline the first time it is seen (the very first read, a new
          // outpost not deployed yet, a permission added later): not news.
          offline.add(outpost.id);
          continue;
        }
        const reads = (this.offlineReads.get(outpost.id) ?? 0) + 1;
        this.offlineReads.set(outpost.id, reads);
        if (reads >= READS_BEFORE_OFFLINE && !offline.has(outpost.id)) {
          offline.add(outpost.id);
          logger.info(`Outpost ${outpost.name} is offline`);
          push(TRIGGERS.OUTPOST_OFFLINE, { outpost: outpost.name, type: outpost.type });
        }
      }
      for (const id of offline) {
        if (!known.has(id)) {
          offline.delete(id); // deleted in authentik
        }
      }
      const nextSeen = [...known].sort();
      if (JSON.stringify(nextSeen) !== JSON.stringify([...seen].sort())) {
        saved.outposts = nextSeen;
        dirty = true;
      }
      const nextOffline = [...offline].sort();
      if (JSON.stringify(nextOffline) !== JSON.stringify([...saved.offline].sort())) {
        saved.offline = nextOffline;
        dirty = true;
      }
      this.outposts = outposts;
      if (JSON.stringify(outposts) !== before) {
        widgetChanged = true;
      }
    }
    if (users !== undefined) {
      this.usersAt = now;
      if (users !== null) {
        this.users = users;
      }
    }
    if (version !== undefined) {
      this.versionAt = now;
      if (version !== null) {
        this.version = version;
      }
    }

    saved.initialized = true;
    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(saved);
    }

    const skipped = [...counts.values()].reduce(
      (sum, count) => sum + Math.max(0, count - MAX_EVENTS_PER_READ),
      0,
    );
    if (skipped > 0) {
      logger.info(`${skipped} scene event(s) skipped: more than ${MAX_EVENTS_PER_READ} at once`);
    }
    // The cursor is already saved: an event Gladys refused (restarting, 429)
    // is kept and sent again at the next read.
    const queue = [...this.unsent, ...sceneEvents];
    this.unsent = [];
    for (let i = 0; i < queue.length; i += 1) {
      if (saved !== this.saved) {
        return false; // another server meanwhile: the old one's news are stale
      }
      const [key, data] = queue[i];
      logger.debug(`Scene event ${key}: ${JSON.stringify(data)}`);
      if (!(await this.fire(key, data))) {
        this.unsent = queue.slice(i, i + MAX_UNSENT);
        break;
      }
    }
    if (client === this.client) {
      await this.publishStates();
    }
    return widgetChanged || sceneEvents.length > 0;
  }

  /** Whether a successful login from `country` is unusual. */
  isUnusual(country) {
    if (this.config.usualCountries.length > 0) {
      return !this.config.usualCountries.includes(country);
    }
    // Learning: the first country ever seen is learned silently.
    const known = Object.keys(this.saved.countries);
    return known.length > 0 && !known.includes(country);
  }

  /** @returns {boolean} whether the saved state changed */
  learnCountry(country, at) {
    const previous = this.saved.countries[country];
    if (previous !== undefined && previous >= at) {
      return false;
    }
    // Saved at most once a day per country: no write at every login.
    const changed = previous === undefined || at - previous >= DAY_MS;
    this.saved.countries[country] = changed ? at : previous;
    return changed;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.failures += 1;
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`authentik: ${err.message}`);
    }
    if (this.failures >= FAILURES_BEFORE_UNREACHABLE && this.saved.reachable !== false) {
      const wasReachable = this.saved.reachable === true;
      this.saved.reachable = false;
      this.store.save(this.saved);
      if (wasReachable) {
        logger.info('authentik is unreachable');
      }
    }
    // Every failed read: "reachable" 0 once unreachable, and its heartbeat
    // during a long outage (the SDK skips the repeats).
    await this.publishStates();
    return wasError !== err.kind;
  }

  // --- Views -----------------------------------------------------------------

  /** Counts of the last 24 hours. */
  counts() {
    const now = this.now();
    let failed1h = 0;
    let failed24h = 0;
    let logins24h = 0;
    for (const event of this.events.values()) {
      if (event.created < now - DAY_MS) {
        continue;
      }
      if (event.action === 'login_failed') {
        failed24h += 1;
        if (event.created >= now - HOUR_MS) {
          failed1h += 1;
        }
      } else if (event.action === 'login') {
        logins24h += 1;
      }
    }
    return { failed1h, failed24h, logins24h };
  }

  /** { online, total } of the outposts, null when unknown. */
  outpostCounts() {
    if (!this.outposts) {
      return null;
    }
    return {
      online: this.outposts.filter((outpost) => outpost.instances > 0).length,
      total: this.outposts.length,
    };
  }

  /** The security events, latest first. */
  latestEvents(count = Infinity) {
    return [...this.events.values()].sort((a, b) => b.created - a.created).slice(0, count);
  }

  /** The latest event of an action, null when none in 24 hours. */
  latestOf(action) {
    return this.latestEvents().find((event) => event.action === action) ?? null;
  }

  /** @returns {Promise<boolean>} whether Gladys accepted the event */
  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.problems.recover('event', 'Scene events accepted again');
      return true;
    } catch (err) {
      this.problems.fail('event', `Scene event ${key} refused: ${err.message}`);
      return false;
    }
  }

  // --- Publishing to Gladys --------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  /** Publish the Discovery list when it changed (a language…). */
  async publishDevices({ force = false } = {}) {
    let devices;
    if (!this.client) {
      devices = [];
    } else if (this.reachable) {
      devices = [buildServerDevice(this.gladys, { language: this.config.language })];
    } else {
      return; // nothing read: keep the list Gladys has
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read authentik, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) the device: its states sent before were
   * dropped by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated() {
    this.transport = null;
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the device, when added. The SDK skips the values Gladys
   * already has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || !this.isCreated(serverIds(this.gladys).device)) {
      return;
    }
    const outposts = this.outpostCounts();
    const states = serverValues(this.gladys, {
      reachable: this.reachable,
      ...this.counts(),
      users: this.users,
      outpostsOnline: outposts?.online ?? null,
      outpostsTotal: outposts?.total ?? null,
      version: this.version?.current ?? '',
    });
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the device: local, or unreachable. */
  async publishTransports() {
    const externalId = serverIds(this.gladys).device;
    if (!this.client || this.readAt === 0 || !this.isCreated(externalId)) {
      return;
    }
    const transport = this.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    if (this.transport === transport) {
      return;
    }
    try {
      await this.gladys.publishTransports([{ external_id: externalId, transport }]);
      this.transport = transport;
      this.problems.recover('transports', 'Transports accepted again');
    } catch (err) {
      this.problems.fail('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.url === '') {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (!this.config.apiToken) {
      return { connected: false, message: CONNECTION_TEXT.noToken };
    }
    if (this.failing) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      if (status.connected) {
        logger.info(`Connected to authentik (${hostOf(this.config.url)})`);
      }
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  /** Throws the reason authentik cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** The summary of "Test the connection" and of "State of authentik". */
  summary(language) {
    const status = this.connectionStatus();
    if (!status.connected) {
      return pick(status.message, language);
    }
    if (!this.reachable) {
      return labelled('authentik', pick(REPORT_TEXT, language).unreachable, language);
    }
    const text = pick(REPORT_TEXT, language);
    const { failed1h, failed24h, logins24h } = this.counts();
    const parts = [text.failed(failed1h, failed24h), text.logins(logins24h)];
    const outposts = this.outpostCounts();
    if (outposts && outposts.total > 0) {
      parts.push(text.outposts(outposts.online, outposts.total));
    }
    if (Number.isInteger(this.users)) {
      parts.push(text.users(this.users));
    }
    for (const [key, error] of Object.entries(this.partial)) {
      if (error) {
        parts.push(pick(PARTIAL_TEXT[key], language));
      }
    }
    return labelled('authentik', parts.join(', '), language);
  }

  /** "Test the connection": read authentik now, one line per language. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    for (const language of Object.keys(REPORT_TEXT)) {
      const status = this.connectionStatus();
      message[language] =
        status.connected && this.reachable
          ? `${pick(REPORT_TEXT, language).ok(this.version?.current)}. ${this.summary(language)}`
          : this.summary(language);
    }
    return message;
  }
}

function emptySaved(url) {
  return {
    url,
    initialized: false,
    reachable: null,
    cursor: 0,
    recent: [],
    countries: {},
    offline: [],
    outposts: [],
  };
}

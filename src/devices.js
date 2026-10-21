// -----------------------------------------------------------------------------
// The Gladys device, proposed in the Discovery tab (the user adds it):
//
//   one "authentik" device for the server:
//     reachable            input/binary    1 the API answers, 0 otherwise
//     failed_logins_1h     counter-sensor  failed logins in the last hour
//     failed_logins_24h    counter-sensor  failed logins in the last 24 hours
//     logins_24h           counter-sensor  successful logins in the last 24 h
//     users                counter-sensor  active user accounts (service
//                                          accounts left out)
//     outposts_online      counter-sensor  outposts with a connected instance
//     outposts_total       counter-sensor  outposts declared in authentik
//     version              text/text       version of the server
//
// Published with should_poll: false: the integration reads authentik on its
// own timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const SERVER_TYPE = 'server';
export const SERVER_ID = 'main';
export const MODEL = 'authentik';

// Suffixes of the feature external ids: permanent once published.
export const KEYS = Object.freeze({
  REACHABLE: 'reachable',
  FAILED_1H: 'failed_logins_1h',
  FAILED_24H: 'failed_logins_24h',
  LOGINS_24H: 'logins_24h',
  USERS: 'users',
  OUTPOSTS_ONLINE: 'outposts_online',
  OUTPOSTS_TOTAL: 'outposts_total',
  VERSION: 'version',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [KEYS.REACHABLE]: 'Reachable',
    [KEYS.FAILED_1H]: 'Failed logins (1 h)',
    [KEYS.FAILED_24H]: 'Failed logins (24 h)',
    [KEYS.LOGINS_24H]: 'Logins (24 h)',
    [KEYS.USERS]: 'Users',
    [KEYS.OUTPOSTS_ONLINE]: 'Outposts online',
    [KEYS.OUTPOSTS_TOTAL]: 'Outposts',
    [KEYS.VERSION]: 'Version',
  },
  fr: {
    [KEYS.REACHABLE]: 'Joignable',
    [KEYS.FAILED_1H]: 'Échecs de connexion (1 h)',
    [KEYS.FAILED_24H]: 'Échecs de connexion (24 h)',
    [KEYS.LOGINS_24H]: 'Connexions (24 h)',
    [KEYS.USERS]: 'Utilisateurs',
    [KEYS.OUTPOSTS_ONLINE]: 'Avant-postes en ligne',
    [KEYS.OUTPOSTS_TOTAL]: 'Avant-postes',
    [KEYS.VERSION]: 'Version',
  },
  de: {
    [KEYS.REACHABLE]: 'Erreichbar',
    [KEYS.FAILED_1H]: 'Fehlgeschlagene Anmeldungen (1 h)',
    [KEYS.FAILED_24H]: 'Fehlgeschlagene Anmeldungen (24 h)',
    [KEYS.LOGINS_24H]: 'Anmeldungen (24 h)',
    [KEYS.USERS]: 'Benutzer',
    [KEYS.OUTPOSTS_ONLINE]: 'Outposts online',
    [KEYS.OUTPOSTS_TOTAL]: 'Outposts',
    [KEYS.VERSION]: 'Version',
  },
  es: {
    [KEYS.REACHABLE]: 'Accesible',
    [KEYS.FAILED_1H]: 'Inicios de sesión fallidos (1 h)',
    [KEYS.FAILED_24H]: 'Inicios de sesión fallidos (24 h)',
    [KEYS.LOGINS_24H]: 'Inicios de sesión (24 h)',
    [KEYS.USERS]: 'Usuarios',
    [KEYS.OUTPOSTS_ONLINE]: 'Outposts en línea',
    [KEYS.OUTPOSTS_TOTAL]: 'Outposts',
    [KEYS.VERSION]: 'Versión',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_EVENTS = 100_000;
export const MAX_USERS = 1_000_000;
export const MAX_OUTPOSTS = 1_000;

export const serverIds = (gladys) => gladys.externalIds(SERVER_TYPE, SERVER_ID);

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

/** The discovery payload of the server. */
export function buildServerDevice(gladys, { language = 'en' } = {}) {
  const ids = serverIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  const feature = (key) => ids.feature(key);
  return {
    name: 'authentik',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: [
      sensor(
        names[KEYS.REACHABLE],
        feature(KEYS.REACHABLE),
        DEVICE_FEATURE_CATEGORIES.INPUT,
        DEVICE_FEATURE_TYPES.SENSOR.BINARY,
        { keep_history: true, min: 0, max: 1 },
      ),
      counter(names[KEYS.FAILED_1H], feature(KEYS.FAILED_1H), MAX_EVENTS),
      counter(names[KEYS.FAILED_24H], feature(KEYS.FAILED_24H), MAX_EVENTS),
      counter(names[KEYS.LOGINS_24H], feature(KEYS.LOGINS_24H), MAX_EVENTS),
      counter(names[KEYS.USERS], feature(KEYS.USERS), MAX_USERS),
      counter(names[KEYS.OUTPOSTS_ONLINE], feature(KEYS.OUTPOSTS_ONLINE), MAX_OUTPOSTS),
      counter(names[KEYS.OUTPOSTS_TOTAL], feature(KEYS.OUTPOSTS_TOTAL), MAX_OUTPOSTS),
      sensor(
        names[KEYS.VERSION],
        feature(KEYS.VERSION),
        DEVICE_FEATURE_CATEGORIES.TEXT,
        DEVICE_FEATURE_TYPES.TEXT.TEXT,
        { keep_history: false, min: 0, max: 0 },
      ),
    ],
  };
}

/**
 * The values of the device: only "reachable" when the API does not answer
 * (the counts keep their last value). A null count is unknown (its endpoint
 * failed, a permission missing): not sent.
 * @param {object} view { reachable, failed1h, failed24h, logins24h, users,
 *   outpostsOnline, outpostsTotal, version }
 */
export function serverValues(gladys, view) {
  const ids = serverIds(gladys);
  const values = [{ key: KEYS.REACHABLE, state: view.reachable ? 1 : 0 }];
  if (view.reachable) {
    const counts = [
      [KEYS.FAILED_1H, view.failed1h],
      [KEYS.FAILED_24H, view.failed24h],
      [KEYS.LOGINS_24H, view.logins24h],
      [KEYS.USERS, view.users],
      [KEYS.OUTPOSTS_ONLINE, view.outpostsOnline],
      [KEYS.OUTPOSTS_TOTAL, view.outpostsTotal],
    ];
    for (const [key, state] of counts) {
      if (Number.isInteger(state)) {
        values.push({ key, state });
      }
    }
    if (view.version) {
      values.push({ key: KEYS.VERSION, text: view.version });
    }
  }
  return values.map(({ key, ...value }) => ({
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}

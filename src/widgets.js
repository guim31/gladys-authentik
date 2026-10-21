// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `security_events`.
//
// The use case: a glance at the wall tablet tells whether someone is trying
// passwords on the home single sign-on, and who logged in lately. So the
// widget shows the failed and successful logins of the last 24 hours and the
// outposts online, then the latest security events — user, what happened,
// country and time — latest first.
//
// The figures are sent as values, not bound to device features: the widget
// works before the device is added.
//
// Budget (8 components, 2 texts): three tiles, one text when authentik does
// not answer or nothing happened, one status list, a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { CONNECTION_TEXT, ERROR_TEXT, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 8;

export const TEXT = {
  empty: {
    en: 'No security event in the last 24 hours.',
    fr: 'Aucun événement de sécurité ces dernières 24 heures.',
    de: 'Kein Sicherheitsereignis in den letzten 24 Stunden.',
    es: 'Ningún evento de seguridad en las últimas 24 horas.',
  },
  failed: { en: 'Failures 24 h', fr: 'Échecs 24 h', de: 'Fehlversuche 24 h', es: 'Fallos 24 h' },
  logins: { en: 'Logins 24 h', fr: 'Connexions 24 h', de: 'Anmeldungen 24 h', es: 'Accesos 24 h' },
  outposts: { en: 'Outposts', fr: 'Avant-postes', de: 'Outposts', es: 'Outposts' },
  unknown: { en: 'unknown user', fr: 'inconnu', de: 'unbekannt', es: 'desconocido' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'authentik read again.',
    fr: 'authentik relu.',
    de: 'authentik neu gelesen.',
    es: 'authentik leído de nuevo.',
  },
};

// What happened, in a few words (the value of a row).
export const ACTION_LABELS = {
  login: { en: 'login', fr: 'connexion', de: 'Anmeldung', es: 'acceso' },
  login_failed: { en: 'failed login', fr: 'échec', de: 'Fehlversuch', es: 'fallo' },
  suspicious_request: { en: 'suspicious', fr: 'suspect', de: 'verdächtig', es: 'sospechoso' },
  password_set: { en: 'password set', fr: 'mot de passe', de: 'Passwort', es: 'contraseña' },
  impersonation_started: {
    en: 'impersonation',
    fr: 'usurpation',
    de: 'Identitätswechsel',
    es: 'suplantación',
  },
};

const ROW_STYLE = {
  login: { icon: 'log-in', color: WIDGET_COLORS.SUCCESS },
  login_failed: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
};
const OTHER_STYLE = { icon: 'alert-triangle', color: WIDGET_COLORS.WARNING };

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

/** "14:05" in the time zone of Gladys (TZ, set by the supervisor). */
export function formatTime(ms, now) {
  const date = new Date(ms);
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return now - ms >= 20 * 3600_000
    ? `${date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })} ${time}`
    : time;
}

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

async function get(hub, { language = 'en' }) {
  const status = hub.connectionStatus();
  if (!hub.client) {
    return message(status.message ?? CONNECTION_TEXT.noUrl, language);
  }
  const now = hub.now();
  const { failed24h, logins24h } = hub.counts();
  const components = [
    {
      type: 'value',
      value: failed24h,
      label: pick(TEXT.failed, language),
      icon: 'x-circle',
      color: failed24h > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: logins24h,
      label: pick(TEXT.logins, language),
      icon: 'log-in',
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  const outposts = hub.outpostCounts();
  if (outposts && outposts.total > 0) {
    components.push({
      type: 'value',
      value: `${outposts.online}/${outposts.total}`,
      label: pick(TEXT.outposts, language),
      icon: 'server',
      color: outposts.online < outposts.total ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
    });
  }

  if (hub.failing) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  const events = hub.latestEvents(MAX_ROWS);
  if (events.length > 0) {
    components.push({
      type: 'status',
      items: events.map((event) => {
        const when = formatTime(event.created, now);
        const what = pick(ACTION_LABELS[event.action] ?? { en: event.action }, language);
        const where = event.country ? ` · ${event.country}` : '';
        return {
          label: fit(event.username || pick(TEXT.unknown, language), 40),
          value: fit(`${what}${where} · ${when}`, 40),
          ...(ROW_STYLE[event.action] ?? OTHER_STYLE),
        };
      }),
    });
  } else if (!hub.failing) {
    components.push({ type: 'text', variant: 'body', text: pick(TEXT.empty, language) });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  return { ttl_seconds: hub.failing ? 30 : 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  if (!hub.client) {
    return { message: hub.connectionStatus().message ?? CONNECTION_TEXT.noUrl };
  }
  await hub.pollNow();
  if (hub.failing) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};

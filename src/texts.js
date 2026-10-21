// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, scene outputs.
// Four languages, the four of the Gladys interface; German says "du", Spanish
// "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './authentik/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of authentik in the configuration.',
    fr: "Saisissez l'adresse d'authentik dans la configuration.",
    de: 'Gib die Adresse von authentik in der Konfiguration ein.',
    es: 'Introduzca la dirección de authentik en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. https://auth.example.com',
    fr: 'Adresse incomprise, ex. https://auth.example.com',
    de: 'Adresse nicht verstanden, z. B. https://auth.example.com',
    es: 'Dirección no válida, p. ej. https://auth.example.com',
  },
  noToken: {
    en: 'Enter an API token of authentik (see the documentation).',
    fr: "Saisissez un jeton d'API d'authentik (voir la documentation).",
    de: 'Gib ein API-Token von authentik ein (siehe Dokumentation).',
    es: 'Introduzca un token de API de authentik (consulte la documentación).',
  },
};

// One short explanation per error kind (src/authentik/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'authentik does not answer',
    fr: 'authentik ne répond pas',
    de: 'authentik antwortet nicht',
    es: 'authentik no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'TLS refused: trusted certificate needed, or http:// (port 9000)',
    fr: 'TLS refusé : certificat reconnu nécessaire, ou http:// (port 9000)',
    de: 'TLS abgelehnt: vertrauenswürdiges Zertifikat nötig oder http:// (Port 9000)',
    es: 'TLS rechazado: hace falta un certificado reconocido, o http:// (puerto 9000)',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'API token refused (expired or deleted?)',
    fr: "jeton d'API refusé (expiré ou supprimé ?)",
    de: 'API-Token abgelehnt (abgelaufen oder gelöscht?)',
    es: 'token de API rechazado (¿caducado o eliminado?)',
  },
  [ERROR_KINDS.FORBIDDEN]: {
    en: 'permission missing for the token: see the documentation',
    fr: 'permission manquante pour le jeton : voir la documentation',
    de: 'Dem Token fehlt eine Berechtigung: siehe Dokumentation',
    es: 'falta un permiso al token: consulte la documentación',
  },
  [ERROR_KINDS.NOT_AUTHENTIK]: {
    en: 'no authentik API at this address',
    fr: "pas d'API authentik à cette adresse",
    de: 'keine authentik-API unter dieser Adresse',
    es: 'no hay API de authentik en esta dirección',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report and the sentence of "State of authentik".
export const REPORT_TEXT = {
  en: {
    ok: (version) => `Connected (${version || 'version unknown'})`,
    failed: (hour, day) => `${hour} failed login(s) in 1 h, ${day} in 24 h`,
    logins: (count) => `${count} login(s) in 24 h`,
    outposts: (online, total) => `outposts online: ${online}/${total}`,
    users: (count) => `${count} user(s)`,
    unreachable: 'authentik does not answer',
  },
  fr: {
    ok: (version) => `Connecté (${version || 'version inconnue'})`,
    failed: (hour, day) => `${hour} échec(s) de connexion en 1 h, ${day} en 24 h`,
    logins: (count) => `${count} connexion(s) en 24 h`,
    outposts: (online, total) => `avant-postes en ligne : ${online}/${total}`,
    users: (count) => `${count} utilisateur(s)`,
    unreachable: 'authentik ne répond pas',
  },
  de: {
    ok: (version) => `Verbunden (${version || 'Version unbekannt'})`,
    failed: (hour, day) => `${hour} fehlgeschlagene Anmeldung(en) in 1 h, ${day} in 24 h`,
    logins: (count) => `${count} Anmeldung(en) in 24 h`,
    outposts: (online, total) => `Outposts online: ${online}/${total}`,
    users: (count) => `${count} Benutzer`,
    unreachable: 'authentik antwortet nicht',
  },
  es: {
    ok: (version) => `Conectado (${version || 'versión desconocida'})`,
    failed: (hour, day) => `${hour} inicio(s) de sesión fallido(s) en 1 h, ${day} en 24 h`,
    logins: (count) => `${count} inicio(s) de sesión en 24 h`,
    outposts: (online, total) => `outposts en línea: ${online}/${total}`,
    users: (count) => `${count} usuario(s)`,
    unreachable: 'authentik no responde',
  },
};

// Partial failures: authentik answers, one of its endpoints does not.
export const PARTIAL_TEXT = {
  outposts: {
    en: 'outposts not readable (permission?)',
    fr: 'avant-postes illisibles (permission ?)',
    de: 'Outposts nicht lesbar (Berechtigung?)',
    es: 'outposts ilegibles (¿permiso?)',
  },
  users: {
    en: 'users not readable (permission?)',
    fr: 'utilisateurs illisibles (permission ?)',
    de: 'Benutzer nicht lesbar (Berechtigung?)',
    es: 'usuarios ilegibles (¿permiso?)',
  },
  version: {
    en: 'version not readable (permission?)',
    fr: 'version illisible (permission ?)',
    de: 'Version nicht lesbar (Berechtigung?)',
    es: 'versión ilegible (¿permiso?)',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

# authentik

[authentik](https://goauthentik.io/) ist ein freier Identitätsanbieter: Single
Sign-on (SSO) und Mehr-Faktor-Authentifizierung für die Dienste deines Zuhauses
oder deiner Firma. Diese Integration bringt seine **Sicherheitsereignisse** zu
Gladys: ein Gerät „authentik“ mit den Fehlversuchen und Anmeldungen des Tages
und den Outposts online, Szenen, die bei einer fehlgeschlagenen Anmeldung, einer
Serie von Fehlversuchen, einer Anmeldung aus einem ungewöhnlichen Land, einem
Outpost offline oder einem anderen Sicherheitsereignis auslösen (um dir eine
Benachrichtigung mit Benutzer, Adresse und Land zu schicken), und ein
Dashboard-Widget mit den letzten Ereignissen.

Getestet mit einem echten authentik 2026.8.4 (Docker, mit den offiziellen
GeoIP-Testdatenbanken von MaxMind; Fehlversuche und Anmeldungen über die
Flow-API gespielt). Ohne Produktivinstallation entwickelt: Rückmeldungen sind
willkommen unter [den Issues](https://github.com/guim31/gladys-authentik/issues).

## Was du brauchst

- Gladys Assistant 5.1.0 oder neuer.
- authentik, vom Gladys-Rechner aus erreichbar (seine öffentliche Adresse oder
  seine lokale Adresse auf Port 9000 oder 9443). Getestet mit 2026.8; eine
  ältere Version mit derselben API v3 sollte funktionieren.
- Ein **Dienstkonto** mit einer Rolle, die die Ereignisse, die Benutzer und die
  Outposts lesen darf, und ein **API-Token** dafür (siehe unten).
- Optional: **GeoIP** in authentik (eine kostenlose MaxMind-GeoLite2-Datenbank)
  für Land und Stadt jeder Anmeldung. Ohne sie funktioniert alles außer dem
  Auslöser „Anmeldung aus einem ungewöhnlichen Land“.

Gladys liest nur: In authentik lässt sich von Gladys aus nichts ändern.

## Erste Schritte

### 1. Ein Dienstkonto anlegen

In der Admin-Oberfläche von authentik: **Verzeichnis → Benutzer → Neues
Dienstkonto**, Name `gladys`, „Gruppe erstellen“ und „Läuft ab“ abwählen. Das
dann angezeigte Token ist ein App-Passwort: Es wird **von der API abgelehnt**,
nutze es nicht.

### 2. Ihm die Leseberechtigungen geben

**Verzeichnis → Rollen → Erstellen**, Name `Gladys read-only`. In der Rolle,
Reiter **Berechtigungen → Berechtigung zuweisen**, füge hinzu:

- `authentik_events | event | Can view Event` (`view_event`);
- `authentik_core | User | Can view User` (`view_user`);
- `authentik_outposts | Outpost | Can view Outpost` (`view_outpost`).

Dann Reiter **Benutzer → Vorhandenen Benutzer hinzufügen**: das Konto `gladys`.

### 3. Ein API-Token erstellen

**Verzeichnis → Tokens und App-Passwörter → Erstellen**: Kennung `gladys-api`,
Benutzer `gladys`, Zweck **API**, „Läuft ab“ abwählen. Kopiere das Token mit
der Schaltfläche „Token kopieren“.

### 4. Die Integration konfigurieren

In Gladys, **Integrationen → authentik → Konfiguration**:

- **Adresse von authentik**: z. B. `https://auth.example.com`.
- **API-Token**: das Token aus Schritt 3.
- **Fehlversuche für eine Serie** und **Zeitfenster der Serie**: die Regel des
  Auslösers „Serie fehlgeschlagener Anmeldungen“, standardmäßig 5 Fehlversuche
  in 10 Minuten.
- **Übliche Länder**: ISO-Codes der Länder, aus denen sich deine Benutzer
  anmelden (`DE, AT`). Leer lernt die Integration sie selbst (siehe unten).
- **Aktualisierungsintervall**: standardmäßig 1 Minute.
- **Sprache der Namen**: Sprache der Funktionsnamen und des Satzes.

**Verbindung testen** liest authentik sofort und fasst zusammen, was es sieht.

### 5. Das Gerät hinzufügen

Füge unter **Erkennung** das Gerät „authentik“ hinzu.

## Das Gerät

| Funktion                             | Inhalt                                              |
| ------------------------------------ | --------------------------------------------------- |
| `Erreichbar`                         | 1, wenn die API von authentik antwortet, sonst 0    |
| `Fehlgeschlagene Anmeldungen (1 h)`  | Fehlgeschlagene Anmeldungen der letzten Stunde      |
| `Fehlgeschlagene Anmeldungen (24 h)` | Fehlgeschlagene Anmeldungen der letzten 24 Stunden  |
| `Anmeldungen (24 h)`                 | Erfolgreiche Anmeldungen der letzten 24 Stunden     |
| `Benutzer`                           | Aktive Benutzerkonten (ohne Dienstkonten)           |
| `Outposts online`                    | Outposts mit mindestens einer verbundenen Instanz   |
| `Outposts`                           | In authentik angelegte Outposts (eingebetteter mit) |
| `Version`                            | Version des authentik-Servers                       |

„Erreichbar“ geht nach zwei fehlgeschlagenen Lesevorgängen hintereinander auf 0:
Ein Neustart von authentik bleibt unbemerkt. Die Zähler können wie jeder Sensor
Szenen auslösen (z. B. „Fehlgeschlagene Anmeldungen (1 h)“ über 20).

## Dashboard

Das Widget **authentik-Sicherheit** zeigt die Fehlversuche und Anmeldungen der
letzten 24 Stunden, die Outposts online und dann die letzten
Sicherheitsereignisse (Benutzer, was passiert ist, Land, Uhrzeit).
**Aktualisieren** liest authentik neu.

## Szenen

### Auslöser

- **Fehlgeschlagene Anmeldung**: Jemand hat ein falsches Passwort oder einen
  unbekannten Benutzernamen eingegeben. Filter: der Benutzername. Variablen:
  eingegebener Benutzername, Adresse, Land, Stadt.
- **Serie fehlgeschlagener Anmeldungen**: Die Fehlversuche erreichen die in der
  Konfiguration eingestellte Zahl in ihrem Zeitfenster. Einmal pro Serie, dann
  erst wieder, wenn die Zahl unter die Schwelle gefallen ist. Variablen: Zahl
  der Fehlversuche, Zeitfenster, verschiedene Benutzernamen und Adressen,
  letzter Benutzername, letzte Adresse und letztes Land.
- **Anmeldung aus einem ungewöhnlichen Land**: eine erfolgreiche Anmeldung aus
  einem Land außerhalb der üblichen. Ist das Feld „Übliche Länder“ leer, lernt
  die Integration die Länder der erfolgreichen Anmeldungen (das erste still, die
  letzten 24 Stunden beim ersten Start): Die erste Anmeldung aus einem neuen
  Land löst aus, die nächsten nicht. Filter: der Benutzername. Variablen:
  Benutzername, Adresse, Land, Stadt.
- **Outpost offline**: Ein Outpost (Proxy, LDAP, RADIUS…) hat zwei
  Lesevorgänge hintereinander keine verbundene Instanz. Einmal, bis er zurück
  ist. Filter: der Name des Outposts. Variablen: Name, Typ.
- **Sicherheitsereignis**: eine verdächtige Anfrage, eine Passwortänderung oder
  ein Identitätswechsel durch einen Administrator. Filter: das Ereignis.
  Variablen: Ereignis, Benutzername, Adresse, Land, Stadt, Meldung von
  authentik.

Benutzernamen und Adressen sind personenbezogene Daten: Diese werden an deine
Szenen weitergegeben (für eine Benachrichtigung) und im Widget angezeigt, aber
nie auf der Info-Stufe in die Protokolle der Integration geschrieben.

### Aktionen

- **Zustand von authentik**: fasst authentik für eine Nachricht zusammen:
  Fehlversuche über 1 Stunde und 24 Stunden, Anmeldungen, Outposts online und
  insgesamt, Version, letzter fehlgeschlagener Benutzername und letzte Adresse
  und ein fertiger Satz („authentik: 3 fehlgeschlagene Anmeldung(en) in 1 h, 3
  in 24 h, 2 Anmeldung(en) in 24 h, Outposts online: 1/2, 2 Benutzer“).

### Szenenideen

- **Fehlgeschlagene Anmeldung** mit dem Benutzernamen `admin` → eine
  Benachrichtigung „Jemand probiert das Admin-Konto aus
  {{triggerEvent.data.country}} ({{triggerEvent.data.ip}})“.
- **Serie fehlgeschlagener Anmeldungen** → eine Benachrichtigung, und das Licht
  an der Haustür blinkt rot, wenn niemand zu Hause ist.
- **Outpost offline** → eine Benachrichtigung: Die Webdienste hinter dem Proxy
  authentifizieren nicht mehr.
- Jeden Abend **Zustand von authentik** → der Satz in einer Nachricht.

## Fehlerbehebung

- **„API-Token abgelehnt“**: Das Token ist falsch, abgelaufen, oder es ist das
  App-Passwort des Dienstkontos: Erstelle ein Token mit dem Zweck **API**.
- **„Dem Token fehlt eine Berechtigung“**: Die Rolle hat kein `view_event`, oder
  das Konto ist nicht in der Rolle. „Outposts nicht lesbar“ oder „Benutzer nicht
  lesbar“ im Test: Es fehlt `view_outpost` oder `view_user`.
- **„Zertifikat abgelehnt“**: authentik nutzt ein selbstsigniertes Zertifikat.
  Nutze seine lokale Adresse mit `http://…:9000` oder ein vertrauenswürdiges
  Zertifikat.
- **„keine authentik-API unter dieser Adresse“**: Prüfe die Adresse (die der
  Admin-Oberfläche, ohne `/if/admin`).
- **Kein Land in den Ereignissen**: GeoIP ist in authentik nicht eingerichtet.
- Ausführliche Protokolle: `LOG_LEVEL=debug` am Container.

## Grenzen

- authentik hat keinen Datumsfilter für seine Ereignisse: Die Integration liest
  die letzten Seiten bis zu einem bereits gesehenen Ereignis, höchstens 1.000
  Ereignisse pro Lesevorgang, 3.000 beim ersten. Darüber hinaus (ein massiver
  Angriff) sind die Zähler Mindestwerte.
- Höchstens 10 Szenenereignisse pro Auslöser und Lesevorgang: Ein Angriff
  schickt nie Hunderte Benachrichtigungen.
- Was passiert ist, während die Integration gestoppt war, wird beim nächsten
  Start gemeldet (innerhalb der letzten 24 Stunden; das Datum des letzten
  Ereignisses wird in `/data` gespeichert); der allererste Start meldet nichts.
- Die von authentik gespeicherten Ereignisse laufen nach der in authentik
  eingestellten Aufbewahrungszeit ab.
- Nur die Anmeldungen und die oben genannten Sicherheitsereignisse werden
  verfolgt, nicht die Freigaben von Anwendungen oder Konfigurationsänderungen.

Nicht mit Authentik Security Inc. verbunden.

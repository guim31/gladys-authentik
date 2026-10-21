# authentik

[authentik](https://goauthentik.io/) is an open-source identity provider: single
sign-on (SSO) and multi-factor authentication for the services of your home or
your company. This integration brings its **security events** into Gladys: an
"authentik" device with the failed and successful logins of the day and the
outposts online, scenes that fire on a failed login, a series of failures, a
login from an unusual country, an outpost going offline or another security
event (to send yourself a notification with the user, the address and the
country), and a dashboard widget with the latest events.

Tested against a real authentik 2026.8.4 (Docker, with the official MaxMind
GeoIP test databases; failed and successful logins played through the flow
API). Developed without a production installation: feedback welcome on
[the issues](https://github.com/guim31/gladys-authentik/issues).

## What you need

- Gladys Assistant 5.1.0 or later.
- authentik, reachable from the Gladys machine (its public address, or its
  local address on port 9000 or 9443). Tested with 2026.8; an older version
  with the same API v3 should work.
- A **service account** with a role that can read the events, the users and the
  outposts, and an **API token** for it (below).
- Optional: **GeoIP** in authentik (a free MaxMind GeoLite2 database), for the
  country and the city of each login. Without it, everything works except the
  "Login from an unusual country" trigger.

Gladys only reads: nothing in authentik can be changed from Gladys.

## Getting started

### 1. Create a service account

In the admin interface of authentik: **Directory → Users → New service
account**, name `gladys`, untick "Create group" and "Expiring". The token shown
then is an app password: it is **refused by the API**, do not use it.

### 2. Give it the read permissions

**Directory → Roles → Create**, name `Gladys read-only`. In the role, tab
**Permissions → Assign permission**, add:

- `authentik_events | event | Can view Event` (`view_event`);
- `authentik_core | User | Can view User` (`view_user`);
- `authentik_outposts | Outpost | Can view Outpost` (`view_outpost`).

Then tab **Users → Add existing user**: the `gladys` account.

### 3. Create an API token

**Directory → Tokens and App passwords → Create**: identifier `gladys-api`,
user `gladys`, intent **API**, untick "Expiring". Copy the token with the
"Copy token" button.

### 4. Configure the integration

In Gladys, **Integrations → authentik → Configuration**:

- **Address of authentik**: e.g. `https://auth.example.com`.
- **API token**: the token of step 3.
- **Failed logins in a series** and **Window of the series**: the rule of the
  "Series of failed logins" trigger, 5 failures in 10 minutes by default.
- **Usual countries**: ISO codes of the countries your users log in from
  (`FR, BE`). Left empty, the integration learns them (see below).
- **Refresh interval**: 1 minute by default.
- **Language of the names**: language of the feature names and of the sentence.

**Test the connection** reads authentik at once and sums up what it sees.

### 5. Add the device

In **Discovery**, add the "authentik" device.

## The device

| Feature                | What it holds                                         |
| ---------------------- | ----------------------------------------------------- |
| `Reachable`            | 1 when the API of authentik answers, 0 otherwise      |
| `Failed logins (1 h)`  | Failed logins of the last hour                        |
| `Failed logins (24 h)` | Failed logins of the last 24 hours                    |
| `Logins (24 h)`        | Successful logins of the last 24 hours                |
| `Users`                | Active user accounts (service accounts left out)      |
| `Outposts online`      | Outposts with at least one connected instance         |
| `Outposts`             | Outposts declared in authentik (embedded one counted) |
| `Version`              | Version of the authentik server                       |

"Reachable" goes to 0 after two failed reads in a row: a restart of authentik
goes unnoticed. The counts can trigger scenes like any sensor (e.g. "Failed
logins (1 h)" above 20).

## Dashboard

The **authentik security** widget shows the failed and successful logins of the
last 24 hours, the outposts online, then the latest security events (user, what
happened, country, time). **Refresh** reads authentik again.

## Scenes

### Triggers

- **Failed login**: someone typed a wrong password or an unknown user name.
  Filter: the user name. Variables: user name typed, address, country, city.
- **Series of failed logins**: the failures reach the number set in the
  configuration within its window. Fires once per series, then again only once
  the count fell below the threshold. Variables: number of failures, window,
  different user names and addresses, the latest user name, address and country.
- **Login from an unusual country**: a successful login from a country outside
  the usual ones. With the "Usual countries" field empty, the integration
  learns the countries of the successful logins (the first one silently, the
  last 24 hours at the first start): the first login from a new country fires,
  the next ones do not. Filter: the user name. Variables: user name, address,
  country, city.
- **Outpost offline**: an outpost (proxy, LDAP, RADIUS…) has no connected
  instance during two reads in a row. Once, until it is back. Filter: the
  outpost name. Variables: name, type.
- **Security event**: a suspicious request, a password change or an
  impersonation by an administrator. Filter: the event. Variables: event, user
  name, address, country, city, message of authentik.

User names and addresses are personal data: they are passed to your scenes (to
write a notification) and shown on the widget, never written to the
integration logs at the info level.

### Actions

- **State of authentik**: sums up authentik for a message: failed logins over 1
  hour and 24 hours, logins, outposts online and in total, version, the latest
  failed user name and address, and a ready-made sentence ("authentik: 3 failed
  login(s) in 1 h, 3 in 24 h, 2 login(s) in 24 h, outposts online: 1/2, 2
  user(s)").

### Scene ideas

- **Failed login** with the user name `admin` → a notification "Someone tries
  the admin account from {{triggerEvent.data.country}}
  ({{triggerEvent.data.ip}})".
- **Series of failed logins** → a notification, and the porch light blinks red
  if nobody is home.
- **Outpost offline** → a notification: the web services behind the proxy no
  longer authenticate.
- Every evening, **State of authentik** → the sentence in a message.

## Troubleshooting

- **"API token refused"**: the token is wrong, expired, or it is the app
  password of the service account: create a token with the **API** intent.
- **"permission missing for the token"**: the role does not hold `view_event`,
  or the account is not in the role. "outposts not readable" or "users not
  readable" in the test: `view_outpost` or `view_user` is missing.
- **"TLS refused"**: authentik uses a self-signed certificate, or `https://` was typed for the HTTP port 9000. Use its
  local address in `http://…:9000`, or a trusted certificate.
- **"no authentik API at this address"**: check the address (the one you open
  the admin interface with, without `/if/admin`).
- **No country in the events**: GeoIP is not set up in authentik.
- Detailed logs: set `LOG_LEVEL=debug` on the container.

## Limits

- authentik has no date filter on its events: the integration reads the latest
  pages until an event already seen, 1,000 events at most per read, 3,000 at the
  first read. Beyond (a massive attack), the counts are lower bounds.
- At most 10 scene events per trigger and per read: an attack never sends
  hundreds of notifications.
- What happened while the integration was stopped is announced at the next
  start (within the last 24 hours, the date of the latest event being kept in
  `/data`); the first start announces nothing.
- The events kept by authentik expire after the retention set in authentik.
- Only the logins and the security events listed above are followed, not the
  authorizations of applications or the changes of configuration.

Not affiliated with Authentik Security Inc.

# authentik for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings [authentik](https://goauthentik.io/), the open-source identity
provider (SSO, MFA), into Gladys: who failed to log in, from where, and a
notification the moment it happens.

- **An authentik device**: reachable, failed logins over 1 hour and 24 hours,
  successful logins over 24 hours, active users, outposts online and in total,
  version.
- **Scene triggers**: a failed login (user, address, country), a series of
  failed logins (N in M minutes, set in the configuration), a login from an
  unusual country (with GeoIP in authentik), an outpost going offline, a
  security event (suspicious request, password change, impersonation).
- **Scene action**: state of authentik in a ready-made sentence.
- **Dashboard widget**: the counts of the day and the latest security events.
- Read-only: nothing in authentik can be changed from Gladys.
- Texts in English, French, German and Spanish.

Tested against a real authentik 2026.8.4 (official Docker image, with the
MaxMind GeoIP test databases, a read-only service account, failed and
successful logins played through the flow API, an outpost without instance).
Developed without a production installation: feedback welcome on
[the issues](https://github.com/guim31/gladys-authentik/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- authentik reachable from the Gladys machine, with the API v3.
- A service account in a role holding `view_event`, `view_user` and
  `view_outpost`, and a token with the **API** intent (the app password created
  with the service account is refused by the API).
- Optional: GeoIP in authentik, for the countries.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-authentik`. Then open its configuration,
enter the address of authentik and the API token, and add the device from the
Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container reads the security events (`GET /api/v3/events/events/`, filtered
on `login`, `login_failed`, `suspicious_request`, `password_set` and
`impersonation_started`, latest first) every minute by default: the last 24
hours at start, then only the pages newer than the latest event already seen.
It also reads the outposts and their health, the number of users (every 10
minutes) and the version (every hour). The date of the latest event seen, the
countries learned and the outposts found offline are kept in `/data`, so an
event during a restart is announced once. User names and addresses never go to
the info logs.

## Limits

- One authentik server per integration.
- 1,000 events at most per read (3,000 at start): beyond, the counts are lower
  bounds.
- At most 10 scene events per trigger and per read.
- No country without GeoIP in authentik.
- A self-signed HTTPS certificate is not accepted (use the `http://` local
  address).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the authentik
API.

## Credits

- [authentik](https://github.com/goauthentik/authentik) by Authentik Security
  Inc. and contributors (MIT): the answers in `test/fixtures/authentik` come
  from its official Docker image (`ghcr.io/goauthentik/server:2026.8.4`).
- The countries and cities of the fixtures come from the GeoLite2 test
  databases of [MaxMind-DB](https://github.com/maxmind/MaxMind-DB) (test
  addresses, not real users).
- The authentik logo on the cover is the official one
  (`web/dist/assets/icons/icon_left_brand.svg` of the official image, built
  from the [authentik repository](https://github.com/goauthentik/authentik));
  it belongs to Authentik Security Inc.

Not affiliated with Authentik Security Inc.

## License

Apache-2.0, see [LICENSE](LICENSE).

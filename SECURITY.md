# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the API token of authentik, stored by Gladys in the integration
  configuration, sent only to the authentik address configured, never logged.
  The documentation asks for a service account with read permissions only:
  the integration never writes to authentik;
- `/data/authentik-state.json`: the address of authentik, the date and ids of
  the latest events seen, the countries learned from the successful logins and
  the outposts found offline. No user name, no address;
- user names, addresses and countries of the security events: kept in memory
  for the last 24 hours, passed to the scenes and the widget, logged at the
  debug level only;
- network: outbound HTTP(S) requests to the authentik address only.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the third-party services and devices the integration talks to.

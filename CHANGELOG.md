# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- An "authentik" device: reachable, failed logins over 1 hour and 24 hours,
  successful logins over 24 hours, active users, outposts online and in total,
  version of the server.
- Scene triggers: a failed login, a series of failed logins (number and window
  set in the configuration), a login from an unusual country (configured or
  learned, needs GeoIP in authentik), an outpost going offline, a security
  event (suspicious request, password change, impersonation). User, address,
  country and city as variables.
- Scene action "State of authentik": the counts and a ready-made sentence.
- Dashboard widget "authentik security": the counts of the day and the latest
  security events.
- "Test the connection" action. Read-only API token; nothing announced twice
  across restarts.
- Texts and documentation in English, French, German and Spanish.

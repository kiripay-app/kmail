# KMail

KMail is a GPLv3 fork of [mailcow: dockerized](https://github.com/mailcow/mailcow-dockerized) that
replaces the SOGo web interface with an Outlook-style webmail and calendar, plus an admin panel
protected by two-factor authentication.

> **Status: phase 4 (admin panel with two-step verification), early and untested on a real mailcow stack.** The mail core is unmodified mailcow. KMail's webmail, calendar (day, week, month, repeating events, reminders, meeting invitations and replies) and contacts work against stock Dovecot and a standards-based CalDAV server; SOGo stays as the headless calendar/contacts/ActiveSync backend so phones keep syncing. The admin panel (domains, mailboxes, aliases, DKIM, queue, logs, audit log, mandatory authenticator-app 2FA) works against a fake mailcow API in tests; shared calendars are not built yet.

## What is different from mailcow

| Area | mailcow | KMail |
| --- | --- | --- |
| Mail core (Postfix, Dovecot, Rspamd, ClamAV) | yes | inherited, unchanged |
| Webmail UI | SOGo | `kmail-web` (React + Fluent UI, Outlook-style layout) |
| Calendar / contacts | SOGo UI | `kmail-web` screens over CalDAV/CardDAV; SOGo kept headless (also serves ActiveSync for phones) |
| Admin panel | mailcow UI | `kmail-admin`, own logins, TOTP 2FA + recovery codes, audit log (WebAuthn later); mailcow is reached only through one small adapter |
| Orchestration | Docker Compose | Docker Compose, Helm chart for stateless services later |

See [docs/PLAN.md](docs/PLAN.md) for the full plan and phases.

## Layout

- `kmail-web/` frontend (Vite, React, TypeScript)
- `kmail-api/` backend (Node, TypeScript, Fastify): IMAP/SMTP/CalDAV bridge
- `kmail-admin/` admin panel (Node, Fastify, SQLite, React): see its README
- `docker-compose.override.yml` adds the KMail services to the mailcow stack
- everything else is upstream mailcow, kept mergeable (`git remote add upstream https://github.com/mailcow/mailcow-dockerized`)

## Install (test VM only)

Follow the upstream mailcow install steps (`./generate_config.sh`, `docker compose pull`,
`docker compose up -d`); the override file is picked up automatically.
Do not run this on a production mail server yet.

## Licence and attribution

KMail is released under the **GNU General Public License v3**, the same licence as mailcow. See `LICENSE`.
Based on mailcow: dockerized by The Infrastructure Company GmbH and contributors.
"mailcow" is a registered word mark of The Infrastructure Company GmbH; KMail is an independent
fork and is not affiliated with or endorsed by them. The Outlook-style layout is original work
and does not use Microsoft logos, icons or trademarks. Fluent UI is MIT licensed.

Maintainer: Karotu (Public Utilities Board, Kiribati).

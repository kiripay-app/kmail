# KMail

KMail is a GPLv3 fork of [mailcow: dockerized](https://github.com/mailcow/mailcow-dockerized) that
replaces the SOGo web interface with an Outlook-style webmail and calendar, plus an admin panel
protected by two-factor authentication.

> **Status: phase 2 (webmail MVP), early and untested on a real mailcow stack.** The mail core is unmodified mailcow. KMail webmail (login, folders, list, search, read, reply, forward, send with attachments, flag, move, delete) and its API work against a stock Dovecot; calendar, contacts and the admin panel are not built yet.

## What is different from mailcow

| Area | mailcow | KMail |
| --- | --- | --- |
| Mail core (Postfix, Dovecot, Rspamd, ClamAV) | yes | inherited, unchanged |
| Webmail UI | SOGo | `kmail-web` (React + Fluent UI, Outlook-style layout) |
| Calendar / contacts backend | SOGo | SOGo kept headless at first (CalDAV/CardDAV/ActiveSync) |
| Admin panel | mailcow UI | `kmail-admin`, TOTP + WebAuthn 2FA, audit log |
| Orchestration | Docker Compose | Docker Compose, Helm chart for stateless services later |

See [docs/PLAN.md](docs/PLAN.md) for the full plan and phases.

## Layout

- `kmail-web/` frontend (Vite, React, TypeScript)
- `kmail-api/` backend (Node, TypeScript, Fastify): IMAP/SMTP/CalDAV bridge
- `kmail-admin/` admin panel (2FA)
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

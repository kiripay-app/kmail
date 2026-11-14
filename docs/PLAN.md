# KMail plan

## Decisions
- Public GitHub repo `karotu/kmail`, fork of mailcow-dockerized, GPLv3.
- Mail core unchanged so upstream security fixes can be merged.
- Outlook-style UI built with Fluent UI (MIT); no Microsoft branding or assets.
- SOGo stays headless at first because it also provides CalDAV, CardDAV and ActiveSync.
- Docker Compose is the primary deployment. Kubernetes (Helm) covers the stateless services only;
  Postfix/Dovecot mail storage is stateful and stays on a single node or shared volume.
- Backend: Node/TypeScript.

## Architecture
Dovecot (IMAP) / Postfix (submission) / SOGo (DAV) <- kmail-api <- kmail-web (browser)
kmail-admin (separate path, 2FA) manages domains, mailboxes, aliases, quotas, DKIM, logs, queue.

## Admin 2FA
Separate admin login path; TOTP baseline, WebAuthn/passkeys optional; one-time recovery codes;
rate limiting and lockout; audit log; optional IP allowlist.

## Phases
1. Foundation: fork, rebrand (light), scaffolding, CI, run unchanged on a test VM.
2. Webmail MVP: login, folders, message list, reading pane, compose with attachments, search, flags and move.
3. Calendar and contacts: day/week/month, event create/edit, invites, shared calendars; decide the DAV backend.
4. Admin panel with 2FA.
5. Kubernetes: Helm chart, health checks, autoscaling for web/API, clustering limits documented.
6. Hardening and migration: security review, backups, imapsync guide from Carbonio, pilot mailboxes.

## Open items
- nginx routing: mount KMail under its own path or hostname (needs a custom nginx site file in `data/conf/nginx/`).
- Auth: reuse mailcow mailbox credentials via IMAP login; SSO to SOGo for DAV is to be designed.

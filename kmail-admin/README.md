# kmail-admin

Admin panel for KMail: domains, mailboxes, aliases, DKIM keys, mail queue, logs, administrators and an audit log.
Open it at `https://<mail-host>/kmail-admin/`.

It has its **own** administrators, database and two-step verification, separate from webmail users and from mailcow's own admin UI.

## Security

- Password (scrypt) then a mandatory authenticator code (TOTP, RFC 6238). The first sign-in forces a new password and authenticator setup.
- 10 single-use recovery codes. The same code step accepts them. A used or replayed authenticator code is refused.
- Five wrong attempts lock the account for 15 minutes (`ADMIN_LOCK_MINUTES`), and sign-in is rate limited per address.
- Server-side sessions (30 minutes idle, 8 hours maximum), HttpOnly SameSite=Strict cookie, CSRF header on every change, new session id after 2FA.
- Optional `ADMIN_ALLOW_CIDRS` (for example `10.0.0.0/8,203.0.113.7`) limits who can even reach the panel.
- Every sign-in and change goes to an append-only audit log (enforced by database triggers). Passwords are never logged.
- Authenticator secrets are encrypted at rest (AES-256-GCM) with `ADMIN_SECRET`, or a key generated once in the data volume.
- Not yet: WebAuthn/passkeys, and it is a single instance (sessions live in memory).

## First administrator

```
docker compose exec kmail-admin node dist/cli.js create-admin karotu
```

Prints a temporary password. Other commands: `list`, and `reset-admin <name>` (new temporary password and clears 2FA, for a lost phone with no recovery codes).
Run these only from the server shell: that is the root of trust.

## Talking to the mail server

All mail changes go through one small interface (`src/adapters/types.ts`). Included:

- `mailcow` (default): uses mailcow's HTTP API. In mailcow's admin UI create a read/write API key allowed from `172.22.1.0/24`,
  then add to `mailcow.conf`: `KMAIL_ADMIN_MAILCOW_KEY=<key>`.
- `memory`: a demo backend that keeps nothing (`ADMIN_BACKEND=memory`, `ADMIN_DEMO_DATA=1`).

Another mail server means one more file in `src/adapters/`.

## Settings (environment)

`ADMIN_BACKEND`, `MAILCOW_API_URL`, `MAILCOW_API_KEY`, `MAILCOW_API_TLS_VERIFY`, `ADMIN_SECRET`, `ADMIN_ALLOW_CIDRS`, `ADMIN_ISSUER`,
`ADMIN_IDLE_MINUTES`, `ADMIN_SESSION_HOURS`, `ADMIN_LOCK_MINUTES`, `COOKIE_SECURE` (default true), `DATA_DIR` (default `/data`).

## Develop

`npm install && npm test` (23 tests), `npm run build`, `npm run build:ui`. Needs Node 22+ (uses the built-in `node:sqlite`).

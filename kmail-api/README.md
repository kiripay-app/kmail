# kmail-api

Node/TypeScript (Fastify) bridge between the browser and mailcow's Dovecot (IMAP) and Postfix (SMTP submission).

## Endpoints (all under `/api`, served as `/kmail/api` by nginx)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | liveness |
| POST | `/auth/login` | verify mailbox credentials against Dovecot, set session cookie |
| GET | `/auth/me`, POST `/auth/logout` | session info / end session |
| GET | `/mail/folders` | folders with total and unread counts |
| GET | `/mail/messages?folder=&page=&q=` | message list (50 per page) and search |
| GET | `/mail/messages/:uid?folder=&images=0\|1` | one message; HTML sanitised, remote images blocked unless `images=1`; marks it read |
| GET | `/mail/messages/:uid/attachments/:index?folder=` | attachment download |
| PATCH | `/mail/messages/:uid` | read/unread, flag, move |
| DELETE | `/mail/messages/:uid?folder=` | move to Trash (permanent delete when already in Trash) |
| POST | `/mail/send` | send via Postfix, with attachments, and file a copy in Sent |

## Security notes

- Mailbox passwords are never stored on disk. The session holds the password AES-256-GCM encrypted in memory so IMAP/SMTP can be reopened per request.
- Cookie is `HttpOnly`, `SameSite=Strict`, `Secure`. State-changing calls also require the `x-kmail-csrf: 1` header.
- Login is rate limited (10 per minute per IP). The API port is not published; only nginx reaches it.
- Message HTML is sanitised server-side and shown in a sandboxed iframe with no scripts.
- Known limit: sessions are in process memory, so run one replica until sessions move to Redis (needed for the Kubernetes phase).

## Configuration (environment)

`PORT` (3000), `IMAP_HOST` (dovecot), `IMAP_PORT` (993), `IMAP_SECURE` (true), `IMAP_TLS_REJECT_UNAUTHORIZED` (false, internal network),
`SMTP_HOST` (postfix), `SMTP_PORT` (587), `SMTP_TLS_REJECT_UNAUTHORIZED` (false), `SESSION_SECRET`, `SESSION_TTL_MINUTES` (480), `COOKIE_SECURE` (true; set false for local HTTP development).

## Develop and test

```
npm install
npm test        # unit tests (sanitiser, sessions)
npm run dev
```

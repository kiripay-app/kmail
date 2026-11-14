# Trying KMail on a test VM

1. Install mailcow as usual (`./generate_config.sh`, `docker compose pull`).
2. Add a session secret to `mailcow.conf`: `echo "KMAIL_SESSION_SECRET=$(openssl rand -hex 32)" >> mailcow.conf`
3. `docker compose build kmail-web kmail-api kmail-admin && docker compose up -d`
4. Open `https://<your-mail-hostname>/kmail/` and sign in with a mailbox address and password.
   `https://<your-mail-hostname>/kmail/api/health` should answer `{"status":"ok"}`.
5. If mailcow's nginx fails to reload, run `docker compose exec nginx-mailcow nginx -t` and remove `data/conf/nginx/site.kmail.custom` to roll back.

## What has and has not been tested

Tested against a stock Dovecot 2.3, a local SMTP server and Radicale (a standards-based CalDAV/CardDAV server standing in for SOGo), not the
mailcow containers: login, folders, list, search, read, sanitising, attachments, flag, move, delete, send with attachment, Sent copy;
calendar create/edit/delete with repeating events, meeting invitations (send, update, cancel, accept, decline, apply a reply, spoofed-sender refusal), .ics and .vcf import, address suggestions, contacts create/search/edit/delete; and the browser UI end to end.

Not yet tested: SOGo's own scheduling (the "server schedules by itself" path was tested against a stand-in that announces `calendar-auto-schedule`, not real SOGo), SOGo itself (its discovery and login over CalDAV/CardDAV on port 20000), the Docker images, the nginx routing, mailcow's own Dovecot/Postfix (TLS on 993/587), large attachments
(attachments travel as base64 JSON, so about 33% larger than the file; mailcow's `NGINX_MAX_BODY_SIZE` applies), and `resolver 127.0.0.11`
inside mailcow's nginx. If any of those misbehave, the first run's error output is the fastest way to a fix.

## Calendar and contacts check

Sign in, open Calendar, and create an event. Then open the same account in a phone calendar app or SOGo's own page (`/SOGo`) and confirm it appears there too.
If the Calendar tab says it could not load your calendars, check `docker compose logs kmail-api` for the DAV status and confirm `CALDAV_URL` points at SOGo.

## Invitations check

Create an event, add a colleague as an attendee, and save. They should receive exactly one invitation. If they get two, set `KMAIL_INVITES=never`
(add `KMAIL_INVITES=never` to `mailcow.conf`); if they get none, set `KMAIL_INVITES=always`. Then have them accept, and confirm the status changes in the event.

## Admin panel check

1. In mailcow's admin UI create an API key (read/write) allowed from `172.22.1.0/24`, then `echo "KMAIL_ADMIN_MAILCOW_KEY=<key>" >> mailcow.conf` and `docker compose up -d kmail-admin`.
2. `docker compose exec kmail-admin node dist/cli.js create-admin <yourname>` and note the temporary password.
3. Open `https://<your-mail-hostname>/kmail-admin/`, sign in, choose a new password, scan the QR code and save the recovery codes.
4. Sign out and in again (needs a code). Overview should list the mailcow containers as running. Add a test domain and mailbox, and confirm they appear in mailcow's own UI.
5. If Overview says it cannot reach the API, check `MAILCOW_API_URL`, the key's allowed IP range, and `docker compose logs kmail-admin`.

Tested: the panel's backend (23 tests, including RFC 6238 vectors, lockout, replay, recovery codes, audit) and the browser flow against the in-memory backend, and the mailcow adapter against a fake server built from mailcow's OpenAPI file.
Not yet tested: the real mailcow API (response shapes, the internal HTTPS address, queue and log formats), the Docker image and nginx route.

## Before real users

Read `docs/SECURITY.md` and do its deployment list (fail2ban whitelist for the Docker network, admin IP allow list, session secret).

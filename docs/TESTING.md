# Trying KMail on a test VM

1. Install mailcow as usual (`./generate_config.sh`, `docker compose pull`).
2. Add a session secret to `mailcow.conf`: `echo "KMAIL_SESSION_SECRET=$(openssl rand -hex 32)" >> mailcow.conf`
3. `docker compose build kmail-web kmail-api && docker compose up -d`
4. Open `https://<your-mail-hostname>/kmail/` and sign in with a mailbox address and password.
   `https://<your-mail-hostname>/kmail/api/health` should answer `{"status":"ok"}`.
5. If mailcow's nginx fails to reload, run `docker compose exec nginx-mailcow nginx -t` and remove `data/conf/nginx/site.kmail.custom` to roll back.

## What has and has not been tested

Tested against a stock Dovecot 2.3, a local SMTP server and Radicale (a standards-based CalDAV/CardDAV server standing in for SOGo), not the
mailcow containers: login, folders, list, search, read, sanitising, attachments, flag, move, delete, send with attachment, Sent copy;
calendar create/edit/delete with repeating events, contacts create/search/edit/delete; and the browser UI end to end.

Not yet tested: SOGo itself (its discovery and login over CalDAV/CardDAV on port 20000), the Docker images, the nginx routing, mailcow's own Dovecot/Postfix (TLS on 993/587), large attachments
(attachments travel as base64 JSON, so about 33% larger than the file; mailcow's `NGINX_MAX_BODY_SIZE` applies), and `resolver 127.0.0.11`
inside mailcow's nginx. If any of those misbehave, the first run's error output is the fastest way to a fix.

## Calendar and contacts check

Sign in, open Calendar, and create an event. Then open the same account in a phone calendar app or SOGo's own page (`/SOGo`) and confirm it appears there too.
If the Calendar tab says it could not load your calendars, check `docker compose logs kmail-api` for the DAV status and confirm `CALDAV_URL` points at SOGo.

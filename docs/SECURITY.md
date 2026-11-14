# KMail security notes

This is a working review, not an audit. KMail is early software: keep it on a test VM until it has been run against a real mailcow stack and independently reviewed.

## What the design does

- **Webmail passwords** are never stored by KMail. They are checked against Dovecot, and held in memory (AES-256-GCM, key from `KMAIL_SESSION_SECRET`) only for the length of a session so IMAP/SMTP/CalDAV can be reached on the user's behalf.
- **Sessions** are server-side, in memory, HttpOnly + SameSite=Strict + Secure cookies, and every change needs an `x-kmail-csrf` header.
- **Email HTML** is sanitised on the server and shown in a sandboxed iframe with no scripts. Attachments download as `application/octet-stream` with `nosniff` and a sandbox CSP.
- **Sending** always uses the signed-in mailbox as the envelope sender. A user cannot send as someone else through KMail.
- **Calendar writes** only touch collections the server listed for that user, with ETag checks. Invitation replies and cancellations are checked against the sender's From address (this is not SPF/DKIM proof).
- **Admin panel**: separate accounts, mandatory TOTP, recovery codes, lockout, append-only audit log, optional IP allow list. See `kmail-admin/README.md`.

## Found in review and fixed

1. **Forgeable client address.** nginx appended to `X-Forwarded-For` and both services trusted every hop, so a client could claim any IP. That would bypass the admin IP allow list and the per-IP rate limits. Now nginx replaces the header with the real connecting address, and the services only trust private/Docker ranges (`TRUST_PROXY` to change). Covered by a test.
2. **One webmail user could get webmail banned for everyone.** Every webmail login reaches Dovecot from the same container, and mailcow's netfilter bans an address after repeated failures. A guesser could have triggered a ban on the container. Webmail now stops a user/address after 5 failures (and a mailbox after 20 failures from anywhere) in 15 minutes, before asking Dovecot. Covered by tests.

## Do this when deploying

- In mailcow's admin UI, add the Docker network (`172.22.1.0/24`) to the fail2ban/netfilter **whitelist**. KMail now does its own throttling, and a ban on that network would take the webmail down.
- Set `KMAIL_ADMIN_ALLOW` to the networks admins really use (for example the office and VPN ranges). The panel is then unreachable from everywhere else.
- Keep `COOKIE_SECURE` on (the default) and serve everything over HTTPS only.
- Set `KMAIL_SESSION_SECRET` (random, 32 bytes of hex) so webmail sessions survive restarts.
- Back up the `kmail-admin-data` volume. It holds the admin accounts and audit log.

## Known limits (not fixed yet)

- Sessions live in memory: one instance only, and a restart signs everyone out. Needed before any Kubernetes scaling.
- A person who can guess an admin's username can lock that admin out for 15 minutes with wrong passwords. The IP allow list is the answer to this.
- No WebAuthn/passkeys yet. TOTP codes can be phished in real time.
- The admin API key gives KMail full control of mailcow. Keep that key only in `mailcow.conf` and restrict it to the Docker network.
- IMAP and SMTP inside the Docker network skip certificate checks by default (names do not match). Fine on a private network, not if the services are ever split across hosts.
- Webmail login has no second factor. mailcow's own two-factor for webmail users is tied to SOGo and does not apply here.
- Not tested yet against the real mailcow stack: see `docs/TESTING.md`.

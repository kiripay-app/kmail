const bool = (v: string | undefined, d: boolean) => (v === undefined ? d : ["1", "true", "yes", "y"].includes(v.toLowerCase()));

export const config = {
  port: Number(process.env.PORT ?? 3000),
  imap: {
    host: process.env.IMAP_HOST ?? "dovecot",
    port: Number(process.env.IMAP_PORT ?? 993),
    secure: bool(process.env.IMAP_SECURE, true),
    // Dovecot's certificate is issued for the public mail hostname, not the internal service name,
    // so verification is off by default for traffic on the private Docker network. Turn on if you
    // point IMAP_HOST at the public hostname.
    rejectUnauthorized: bool(process.env.IMAP_TLS_REJECT_UNAUTHORIZED, false),
  },
  smtp: {
    host: process.env.SMTP_HOST ?? "postfix",
    port: Number(process.env.SMTP_PORT ?? 587),
    rejectUnauthorized: bool(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, false),
  },
  dav: {
    // mailcow's SOGo serves CalDAV and CardDAV from the same place and authenticates mailbox users itself.
    caldavUrl: process.env.CALDAV_URL ?? "http://sogo:20000/SOGo/dav/",
    carddavUrl: process.env.CARDDAV_URL ?? process.env.CALDAV_URL ?? "http://sogo:20000/SOGo/dav/",
  },
  // auto: send invitation emails only if the calendar server does not schedule by itself (SOGo does).
  // always / never override the detection.
  invites: (["auto", "always", "never"].includes(process.env.KMAIL_INVITES ?? "") ? process.env.KMAIL_INVITES : "auto") as "auto" | "always" | "never",
  cookieSecure: bool(process.env.COOKIE_SECURE, true),
  sessionTtlMs: Number(process.env.SESSION_TTL_MINUTES ?? 480) * 60_000,
  // Only these addresses may tell us the real client address (X-Forwarded-For). Default: private/Docker ranges.
  trustProxy: (process.env.TRUST_PROXY ?? "loopback,linklocal,uniquelocal").split(",").map((s) => s.trim()).filter(Boolean),
  pageSize: 50,
};

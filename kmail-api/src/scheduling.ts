import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { config } from "./config.js";
import type { Creds } from "./imap.js";
import type { Method } from "./ical.js";
import { transportFor } from "./smtp.js";

const cache = new Map<string, { auto: boolean; at: number }>();

/** Does the CalDAV server schedule meetings itself (RFC 6638 calendar-auto-schedule)? SOGo does, Radicale does not. */
async function serverSchedules(calendarUrl: string, { user, pass }: Creds): Promise<boolean> {
  const key = new URL(calendarUrl).origin;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 600_000) return hit.auto;
  let auto = false;
  try {
    const res = await fetch(calendarUrl, {
      method: "OPTIONS",
      headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` },
      signal: AbortSignal.timeout(5000),
    });
    auto = (res.headers.get("dav") ?? "").toLowerCase().includes("calendar-auto-schedule");
    cache.set(key, { auto, at: Date.now() });
  } catch {
    // Could not tell. Sending an invitation twice is better than silently not sending it.
  }
  return auto;
}

/** Should KMail email the iTIP message itself? */
export async function shouldSendInvites(calendarUrl: string, creds: Creds): Promise<boolean> {
  if (config.invites === "always") return true;
  if (config.invites === "never") return false;
  return !(await serverSchedules(calendarUrl, creds));
}

export async function sendItip(creds: Creds, o: { method: Method; ics: string; to: string[]; subject: string; text: string }) {
  const to = [...new Set(o.to.map((x) => x.trim()).filter(Boolean))].filter((x) => x.toLowerCase() !== creds.user.toLowerCase());
  if (!to.length) return 0;
  const raw = await new MailComposer({ from: creds.user, to, subject: o.subject, text: o.text, icalEvent: { method: o.method, content: o.ics } }).compile().build();
  await transportFor(creds).sendMail({ envelope: { from: creds.user, to }, raw });
  return to.length;
}

export const when = (start: string, end: string, allDay: boolean) =>
  allDay ? `${start}${end > start ? " (all day)" : ""}` : `${new Date(start).toISOString().replace("T", " ").slice(0, 16)} to ${new Date(end).toISOString().replace("T", " ").slice(0, 16)} UTC`;

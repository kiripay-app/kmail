#!/usr/bin/env node
// Step 4. Puts each person's exported calendar and contacts into their new account by signing in to KMail as them
// (using the one-time password from step 2) and using KMail's own import. Needs Node 18+. Safe to repeat: events and
// contacts that already exist are skipped.
//
//   node 04-import-calendar-contacts.mjs --host https://mail.pub.com.ki --export ~/kmail-export --passwords passwords.csv [--only bob@pub.com.ki] [--dry] [--strip-attendees]
//
// --strip-attendees removes the organiser and attendee lines from events. Use it if the calendar server would otherwise
// email everyone on old events when they are imported (test one person first and see). Events then become plain events.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(n);
const host = (opt("--host") ?? "").replace(/\/$/, ""), exp = opt("--export"), pwFile = opt("--passwords") ?? "passwords.csv", only = opt("--only");
if (!host || !exp) { console.error("usage: --host https://mail.example --export <folder> [--passwords passwords.csv] [--only address] [--dry] [--strip-attendees]"); process.exit(2); }

/** Remove ORGANIZER and ATTENDEE properties (including folded continuation lines). */
export function stripAttendees(ics) {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  return unfolded.split(/\r?\n/).filter((l) => !/^(ORGANIZER|ATTENDEE)[;:]/i.test(l)).join("\r\n");
}

async function call(cookie, method, path, body) {
  const r = await fetch(host + "/kmail/api" + path, {
    method, headers: { "x-kmail-csrf": "1", ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { r, data };
}

const rows = readFileSync(pwFile, "utf8").split(/\r?\n/).filter(Boolean).map((l) => l.split(","));
let done = 0, skippedUsers = 0;
for (const [addr, pw] of rows) {
  if (only && only !== addr) continue;
  const dir = join(exp, "dav", addr);
  const cal = join(dir, "calendar.ics"), con = join(dir, "contacts.vcf");
  if (!existsSync(cal) && !existsSync(con)) { skippedUsers++; continue; }
  console.log(`--- ${addr}`);
  if (flag("--dry")) { console.log(`  would import: ${existsSync(cal) ? "calendar " : ""}${existsSync(con) ? "contacts" : ""}`); continue; }
  const login = await call("", "POST", "/auth/login", { email: addr, password: pw });
  if (!login.r.ok) { console.log(`  sign-in failed (${login.data.error ?? login.r.status})`); continue; }
  const cookie = login.r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  try {
    if (existsSync(cal)) {
      const cals = (await call(cookie, "GET", "/calendar/calendars")).data;
      if (!Array.isArray(cals) || !cals.length) console.log("  no calendar found on the new server");
      else {
        let ics = readFileSync(cal, "utf8"); if (flag("--strip-attendees")) ics = stripAttendees(ics);
        const res = await call(cookie, "POST", "/calendar/import", { calendar: cals[0].id, ics });
        console.log(`  calendar "${cals[0].name}": ${res.r.ok ? JSON.stringify(res.data) : "failed " + (res.data.error ?? res.r.status)}`);
      }
    }
    if (existsSync(con)) {
      const books = (await call(cookie, "GET", "/contacts/books")).data;
      if (!Array.isArray(books) || !books.length) console.log("  no address book found on the new server");
      else {
        const res = await call(cookie, "POST", "/contacts/import", { book: books[0].id, vcf: readFileSync(con, "utf8") });
        console.log(`  contacts "${books[0].name}": ${res.r.ok ? JSON.stringify(res.data) : "failed " + (res.data.error ?? res.r.status)}`);
      }
    }
    done++;
  } finally { await call(cookie, "POST", "/auth/logout", {}); }
}
console.log(`\nFinished: ${done} people processed, ${skippedUsers} had nothing to import.`);

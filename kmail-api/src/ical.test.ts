import { test } from "node:test";
import assert from "node:assert/strict";
import { applyUpdate, buildNew, expand, type EventInput } from "./ical.js";

const timed: EventInput = { title: "Standup", start: "2026-11-16T21:00:00.000Z", end: "2026-11-16T21:30:00.000Z", allDay: false, location: "Room 1" };
const range = (a: string, b: string) => [new Date(a), new Date(b)] as const;

test("timed event round-trips", () => {
  const ics = buildNew(timed, "u1@kmail");
  const [o] = expand(ics, ...range("2026-11-01", "2026-12-01"));
  assert.equal(o.title, "Standup");
  assert.equal(o.start, "2026-11-16T21:00:00.000Z");
  assert.equal(o.location, "Room 1");
  assert.equal(o.recurring, false);
});
test("all-day uses date strings with exclusive end", () => {
  const ics = buildNew({ title: "Holiday", start: "2026-12-25", end: "2026-12-26", allDay: true }, "u2@kmail");
  const [o] = expand(ics, ...range("2026-12-01", "2027-01-01"));
  assert.deepEqual([o.allDay, o.start, o.end], [true, "2026-12-25", "2026-12-26"]);
});
test("weekly recurrence expands inside the window only, honouring count", () => {
  const ics = buildNew({ ...timed, recurrence: { freq: "WEEKLY", count: 4 } }, "u3@kmail");
  assert.equal(expand(ics, ...range("2026-11-01", "2027-03-01")).length, 4);
  const occ = expand(ics, ...range("2026-11-20", "2026-12-10"));
  assert.deepEqual(occ.map((x) => x.start.slice(0, 10)), ["2026-11-23", "2026-11-30", "2026-12-07"]);
  assert.ok(occ.every((x) => x.recurring));
});
test("update keeps attendees and unknown properties", () => {
  const ics = buildNew(timed, "u4@kmail").replace("END:VEVENT", "ATTENDEE;CN=Bob;PARTSTAT=ACCEPTED:mailto:bob@example.net\r\nX-CUSTOM:keepme\r\nEND:VEVENT");
  const out = applyUpdate(ics, { ...timed, title: "Renamed", start: "2026-11-17T21:00:00.000Z", end: "2026-11-17T22:00:00.000Z" });
  assert.match(out, /X-CUSTOM:keepme/);
  const [o] = expand(out, ...range("2026-11-01", "2026-12-01"));
  assert.equal(o.title, "Renamed");
  assert.deepEqual(o.attendees, [{ email: "bob@example.net", name: "Bob", status: "ACCEPTED" }]);
});
test("unbounded recurrence is capped, not infinite", () => {
  const ics = buildNew({ ...timed, recurrence: { freq: "DAILY" } }, "u5@kmail");
  assert.ok(expand(ics, ...range("2026-01-01", "2100-01-01")).length <= 750);
});
test("reminder is written as a VALARM", () => {
  assert.match(buildNew({ ...timed, reminderMinutes: 15 }, "u6@kmail"), /BEGIN:VALARM[\s\S]*TRIGGER:-PT15M/);
});

test("update without recurrence/reminder keeps the repeat rule and alarm; null removes them", () => {
  const ics = buildNew({ ...timed, recurrence: { freq: "WEEKLY", count: 3 }, reminderMinutes: 10 }, "u7@kmail");
  const keep = applyUpdate(ics, { ...timed, title: "Moved" });
  assert.match(keep, /RRULE:/);
  assert.match(keep, /VALARM/);
  assert.equal(expand(keep, ...range("2026-11-01", "2027-03-01")).length, 3);
  const cleared = applyUpdate(ics, { ...timed, recurrence: null, reminderMinutes: null });
  assert.doesNotMatch(cleared, /RRULE:/);
  assert.doesNotMatch(cleared, /VALARM/);
});

import { buildReply, parseInvite, setPartstat, splitByUid, withMethod } from "./ical.js";

test("attendees: organizer set, statuses preserved on edit, removal clears organizer, sequence bumps", () => {
  const ics = buildNew({ ...timed, attendees: ["bob@example.net", "carol@example.net"] }, "u8@kmail", "me@pub.com.ki");
  let [o] = expand(ics, ...range("2026-11-01", "2026-12-01"));
  assert.equal(o.organizer, "me@pub.com.ki");
  assert.deepEqual(o.attendees.map((a) => [a.email, a.status]), [["bob@example.net", "NEEDS-ACTION"], ["carol@example.net", "NEEDS-ACTION"]]);
  const replied = setPartstat(ics, "BOB@example.net", "ACCEPTED");
  const edited = applyUpdate(replied, { ...timed, attendees: ["bob@example.net", "dave@example.net"] }, "me@pub.com.ki");
  [o] = expand(edited, ...range("2026-11-01", "2026-12-01"));
  assert.deepEqual(o.attendees.map((a) => [a.email, a.status]), [["bob@example.net", "ACCEPTED"], ["dave@example.net", "NEEDS-ACTION"]]);
  assert.match(edited, /SEQUENCE:1/);
  const none = applyUpdate(edited, { ...timed, attendees: [] }, "me@pub.com.ki");
  assert.doesNotMatch(none, /ATTENDEE|ORGANIZER/);
  assert.equal(expand(applyUpdate(ics, { ...timed }, "me@pub.com.ki"), ...range("2026-11-01", "2026-12-01"))[0].attendees.length, 2, "undefined attendees keeps them");
});
test("invite parse, method handling and REPLY building", () => {
  const ics = withMethod(buildNew({ ...timed, attendees: ["bob@example.net"] }, "u9@kmail", "me@pub.com.ki"), "REQUEST");
  const inv = parseInvite(ics)!;
  assert.deepEqual([inv.method, inv.uid, inv.title, inv.organizer.email, inv.attendees[0].email], ["REQUEST", "u9@kmail", "Standup", "me@pub.com.ki", "bob@example.net"]);
  assert.doesNotMatch(withMethod(ics, null), /METHOD/);
  const reply = buildReply(ics, "bob@example.net", "DECLINED");
  const r = parseInvite(reply)!;
  assert.deepEqual([r.method, r.uid, r.attendees.length, r.attendees[0].status, r.organizer.email], ["REPLY", "u9@kmail", 1, "DECLINED", "me@pub.com.ki"]);
});
test("setPartstat adds an invitee who was invited under another address", () => {
  const ics = buildNew({ ...timed, attendees: ["bob@example.net"] }, "u10@kmail", "me@pub.com.ki");
  assert.deepEqual(parseInvite(setPartstat(ics, "alias@example.net", "TENTATIVE"))!.attendees.map((a) => a.status), ["NEEDS-ACTION", "TENTATIVE"]);
});
test("import splitting groups a series with its exceptions and keeps time zones", () => {
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:x",
    "BEGIN:VEVENT", "UID:a", "DTSTART:20261116T100000Z", "DTEND:20261116T110000Z", "RRULE:FREQ=DAILY;COUNT=3", "SUMMARY:A", "END:VEVENT",
    "BEGIN:VEVENT", "UID:a", "RECURRENCE-ID:20261117T100000Z", "DTSTART:20261117T120000Z", "DTEND:20261117T130000Z", "SUMMARY:A moved", "END:VEVENT",
    "BEGIN:VEVENT", "UID:b", "DTSTART;VALUE=DATE:20261201", "SUMMARY:B", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  const parts = splitByUid(ics);
  assert.deepEqual(parts.map((p) => p.uid), ["a", "b"]);
  const occ = expand(parts[0].data, ...range("2026-11-01", "2026-12-01"));
  assert.deepEqual(occ.map((o) => [o.start.slice(0, 13), o.title]), [["2026-11-16T10", "A"], ["2026-11-17T12", "A moved"], ["2026-11-18T10", "A"]]);
});

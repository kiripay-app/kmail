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

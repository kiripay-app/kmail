import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { shouldSendInvites } from "./scheduling.js";

const creds = { user: "a@b.co", pass: "x" };
const serve = (dav: string) =>
  new Promise<http.Server>((resolve) => {
    const s = http.createServer((_q, res) => { res.setHeader("DAV", dav); res.end(); });
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
const url = (s: http.Server) => `http://127.0.0.1:${(s.address() as { port: number }).port}/cal/`;

test("KMail leaves invitations to a server that schedules itself (SOGo-like) and sends them for one that does not", async () => {
  const smart = await serve("1, calendar-access, calendar-auto-schedule");
  const plain = await serve("1, calendar-access");
  try {
    assert.equal(await shouldSendInvites(url(smart), creds), false);
    assert.equal(await shouldSendInvites(url(plain), creds), true);
  } finally { smart.close(); plain.close(); }
});
test("if the server cannot be reached, invitations are still sent (a duplicate beats a lost invite)", async () => {
  assert.equal(await shouldSendInvites("http://127.0.0.1:9/cal/", creds), true);
});

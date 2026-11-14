import "./test-env.js";
import assert from "node:assert/strict";
import { before, test } from "node:test";
import { MemoryAdmin } from "./adapters/memory.js";
import { adminCount, createAdmin } from "./auth.js";
import { config } from "./config.js";
import { open, q } from "./db.js";
import { buildServer } from "./server.js";
import { base32Decode, codeAt, stepAt } from "./totp.js";

open(":memory:");
const backend = new MemoryAdmin(true);
const app = await buildServer(backend);
const H = { "x-kmail-csrf": "1" };
const B = "/kmail-admin/api";
const jar = () => { let c = ""; return {
  async call(method: string, url: string, payload?: unknown, headers: Record<string, string> = H) {
    const r = await app.inject({ method: method as any, url: B + url, payload: payload as any, headers: { ...headers, ...(c ? { cookie: c } : {}) } });
    const sc = r.cookies.find((x) => x.name === "kmail_admin"); if (sc) c = `kmail_admin=${sc.value}`;
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : {} };
  } }; };

let temp = "Temp-Password-123";
before(async () => { await createAdmin("alice", temp); });

/** Full first-time sign in; returns a logged-in jar and the TOTP secret. */
async function enrol(user = "alice", pw = temp, newPw = "a long new passphrase 1") {
  const j = jar();
  assert.equal((await j.call("POST", "/login", { username: user, password: pw })).body.stage, "setup");
  const s = (await j.call("GET", "/setup")).body;
  assert.ok(s.qr.startsWith("data:image/png"));
  const code = codeAt(s.secret, stepAt());
  const done = await j.call("POST", "/setup", { code, password: newPw });
  assert.equal(done.body.stage, "full");
  assert.equal(done.body.recoveryCodes.length, 10);
  return { j, secret: s.secret as string, recovery: done.body.recoveryCodes as string[] };
}

test("nothing works without signing in, and writes need the CSRF header", async () => {
  const j = jar();
  assert.equal((await j.call("GET", "/domains")).status, 401);
  assert.equal((await j.call("POST", "/login", { username: "alice", password: "x" }, {})).status, 403);
});

let state: Awaited<ReturnType<typeof enrol>>;
test("first sign in forces a new password and authenticator setup", async () => {
  const j = jar();
  await j.call("POST", "/login", { username: "alice", password: temp });
  assert.equal((await j.call("GET", "/domains")).status, 401, "setup stage cannot reach admin routes");
  const s = (await j.call("GET", "/setup")).body;
  const weak = await j.call("POST", "/setup", { code: codeAt(s.secret, stepAt()), password: "short" });
  assert.equal(weak.status, 400);
  const bad = await j.call("POST", "/setup", { code: "000000", password: "a long new passphrase 1" });
  assert.equal(bad.status, 400);
  state = await enrol();
  assert.equal((await state.j.call("GET", "/domains")).status, 200);
});

test("password-only login is not enough once 2FA is on; a good code finishes it", async () => {
  const j = jar();
  const r = await j.call("POST", "/login", { username: "alice", password: "a long new passphrase 1" });
  assert.equal(r.body.stage, "totp");
  assert.equal((await j.call("GET", "/domains")).status, 401);
  assert.equal((await j.call("POST", "/login/totp", { code: "123456" })).status, 401);
  // the code used during setup is a replay inside the same 30s step; use the next step (within allowed drift)
  const code = codeAt(state.secret, stepAt() + 1);
  const ok = await j.call("POST", "/login/totp", { code });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await j.call("GET", "/domains")).status, 200);
  const replay = jar(); await replay.call("POST", "/login", { username: "alice", password: "a long new passphrase 1" });
  assert.equal((await replay.call("POST", "/login/totp", { code })).status, 401, "same code cannot be reused");
});

test("recovery code works once", async () => {
  const rc = state.recovery[0];
  const j = jar(); await j.call("POST", "/login", { username: "alice", password: "a long new passphrase 1" });
  assert.equal((await j.call("POST", "/login/totp", { code: rc })).body.usedRecovery, true);
  const j2 = jar(); await j2.call("POST", "/login", { username: "alice", password: "a long new passphrase 1" });
  assert.equal((await j2.call("POST", "/login/totp", { code: rc })).status, 401);
});

test("wrong password gives the same answer for unknown users", async () => {
  const j = jar();
  const a = await j.call("POST", "/login", { username: "alice", password: "nope-nope-nope" });
  const b = await j.call("POST", "/login", { username: "nobody", password: "nope-nope-nope" });
  assert.equal(a.status, 401); assert.deepEqual(a.body, b.body);
});

test("account locks after repeated failures", async () => {
  await createAdmin("bob", temp);
  const j = jar();
  for (let i = 0; i < config.maxFailures; i++) assert.equal((await j.call("POST", "/login", { username: "bob", password: "wrong-wrong-wrong" })).status, 401);
  const r = await j.call("POST", "/login", { username: "bob", password: temp });
  assert.equal(r.status, 429, "even the right password is refused while locked");
});

test("domain, mailbox, alias, dkim, queue flows are audited", async () => {
  const j = jar(); await j.call("POST", "/login", { username: "alice", password: "a long new passphrase 1" });
  await j.call("POST", "/login/totp", { code: state.recovery[1] });
  assert.equal((await j.call("POST", "/domains", { name: "pub.com.ki", quotaMiB: 5000 })).status, 200);
  assert.equal((await j.call("POST", "/domains", { name: "not a domain" })).status, 400);
  const mb = await j.call("POST", "/mailboxes", { localPart: "admin", domain: "pub.com.ki", quotaMiB: 1024 });
  assert.equal(mb.status, 200); assert.ok(mb.body.generatedPassword.length >= 12);
  assert.equal((await j.call("POST", "/mailboxes", { localPart: "admin", domain: "pub.com.ki", quotaMiB: 1 })).status, 409);
  assert.equal((await j.call("PATCH", "/mailboxes/admin@pub.com.ki", { active: false })).status, 200);
  assert.equal((await j.call("POST", "/aliases", { address: "hello@pub.com.ki", goto: "admin@pub.com.ki" })).status, 200);
  assert.equal((await j.call("POST", "/aliases", { address: "x@pub.com.ki", goto: "not-an-email" })).status, 400);
  assert.equal((await j.call("POST", "/dkim/pub.com.ki", {})).status, 200);
  assert.equal((await j.call("GET", "/dkim/pub.com.ki")).body.dkim.length, 2048);
  assert.equal((await j.call("POST", "/queue/clear", {})).status, 400, "needs explicit confirmation");
  assert.equal((await j.call("POST", "/queue/clear", { confirm: true })).status, 200);
  assert.equal((await j.call("DELETE", "/domains/pub.com.ki")).status, 409, "domain still has a mailbox");
  const log = (await j.call("GET", "/audit")).body as any[];
  const actions = log.map((l) => l.action);
  for (const a of ["domain.add", "mailbox.add", "alias.add", "dkim.create", "queue.clear", "login.ok.recovery"]) assert.ok(actions.includes(a), a);
  assert.ok(log.some((l) => l.action === "mailbox.add" && !l.ok), "failed duplicate is recorded as a failure");
  assert.ok(!JSON.stringify(log).includes(mb.body.generatedPassword), "passwords never reach the audit log");
});

test("audit log cannot be edited or deleted", () => {
  assert.throws(() => q().prepare("UPDATE audit SET action = 'x'").run(), /append-only/);
  assert.throws(() => q().prepare("DELETE FROM audit").run(), /append-only/);
});

test("admin management: reset clears 2FA and kicks sessions; cannot disable yourself", async () => {
  const j = jar(); await j.call("POST", "/login", { username: "alice", password: "a long new passphrase 1" });
  await j.call("POST", "/login/totp", { code: state.recovery[2] });
  const list = (await j.call("GET", "/admins")).body as any[];
  const me = list.find((a) => a.username === "alice"), bob = list.find((a) => a.username === "bob");
  assert.equal((await j.call("POST", `/admins/${me.id}/disable`)).status, 400);
  assert.equal((await j.call("DELETE", `/admins/${me.id}`)).status, 400);
  const r = await j.call("POST", `/admins/${bob.id}/reset`);
  assert.equal(r.status, 200);
  const bj = jar();
  assert.equal((await bj.call("POST", "/login", { username: "bob", password: r.body.temporaryPassword })).body.stage, "setup", "unlocked, must set up 2FA again");
  assert.equal((await j.call("POST", "/admins", { username: "ab" })).status, 400);
  const created = await j.call("POST", "/admins", { username: "carol" });
  assert.equal(created.status, 200); assert.ok(created.body.temporaryPassword);
  assert.equal((await j.call("POST", "/admins", { username: "carol" })).status, 400);
});

test("own password change checks the current password", async () => {
  const j = jar(); await j.call("POST", "/login", { username: "alice", password: "a long new passphrase 1" });
  await j.call("POST", "/login/totp", { code: state.recovery[3] });
  assert.equal((await j.call("POST", "/account/password", { current: "wrong", next: "another long passphrase 2" })).status, 400);
  assert.equal((await j.call("POST", "/account/password", { current: "a long new passphrase 1", next: "another long passphrase 2" })).status, 200);
  const regen = await j.call("POST", "/account/recovery", { code: state.recovery[4] });
  assert.equal(regen.body.recoveryCodes.length, 10);
  state.recovery = regen.body.recoveryCodes;
  assert.equal((await jar().call("POST", "/login/totp", { code: "x" })).status, 401);
  assert.ok(adminCount() >= 2);
});

test("logout ends the session", async () => {
  const j = jar(); await j.call("POST", "/login", { username: "alice", password: "another long passphrase 2" });
  await j.call("POST", "/login/totp", { code: state.recovery[0] });
  assert.equal((await j.call("GET", "/domains")).status, 200);
  await j.call("POST", "/logout", {});
  assert.equal((await j.call("GET", "/domains")).status, 401);
});

test("IP allow list cannot be dodged with a forged X-Forwarded-For", async () => {
  config.allowCidrs = ["10.0.0.0/8"];
  const r = (remoteAddress: string, xff: string) => app.inject({ method: "GET", url: B + "/me", remoteAddress, headers: { "x-forwarded-for": xff } });
  assert.equal((await r("203.0.113.5", "10.1.1.1")).statusCode, 403, "public peer claiming to be 10.x is still blocked");
  assert.equal((await r("172.22.1.5", "10.1.1.1")).statusCode, 401, "the proxy may report the real client, and 10.x is allowed");
  assert.equal((await r("172.22.1.5", "198.51.100.7")).statusCode, 403, "real client outside the list is blocked");
  config.allowCidrs = [];
});

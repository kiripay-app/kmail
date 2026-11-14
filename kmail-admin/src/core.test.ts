import "./test-env.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { allowed } from "./cidr.js";
import { codeHash, hashPassword, newRecoveryCodes, passwordProblem, seal, unseal, verifyPassword } from "./crypto.js";
import { base32Decode, base32Encode, codeAt, verifyTotp } from "./totp.js";

const rfcSecret = base32Encode(Buffer.from("12345678901234567890"));

test("TOTP matches the RFC 6238 SHA1 vectors", () => {
  assert.equal(codeAt(rfcSecret, Math.floor(59 / 30), 8), "94287082");
  assert.equal(codeAt(rfcSecret, Math.floor(1111111109 / 30), 8), "07081804");
  assert.equal(codeAt(rfcSecret, Math.floor(20000000000 / 30), 8), "65353130");
});

test("base32 round trips", () => {
  const b = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(base32Decode(base32Encode(b)), b);
});

test("TOTP allows one step of drift, rejects older, and refuses replay", () => {
  const now = 1_700_000_000_000, step = Math.floor(now / 30_000);
  assert.ok(verifyTotp(rfcSecret, codeAt(rfcSecret, step), 0, now).ok);
  assert.ok(verifyTotp(rfcSecret, codeAt(rfcSecret, step - 1), 0, now).ok);
  assert.ok(!verifyTotp(rfcSecret, codeAt(rfcSecret, step - 2), 0, now).ok);
  assert.ok(!verifyTotp(rfcSecret, codeAt(rfcSecret, step), step, now).ok, "same step again is a replay");
  assert.ok(!verifyTotp(rfcSecret, "abc123", 0, now).ok);
});

test("password hashing and policy", async () => {
  const h = await hashPassword("correct horse battery");
  assert.ok(await verifyPassword("correct horse battery", h));
  assert.ok(!(await verifyPassword("wrong", h)));
  assert.ok(passwordProblem("short", "bob"));
  assert.ok(passwordProblem("bobbobbobbobbob1", "bob"));
  assert.ok(passwordProblem("aaaaaaaaaaaaaa", "bob"));
  assert.equal(passwordProblem("a fine long passphrase", "bob"), undefined);
});

test("secrets seal and unseal; tampering fails", () => {
  const s = seal("JBSWY3DPEHPK3PXP");
  assert.equal(unseal(s), "JBSWY3DPEHPK3PXP");
  const buf = Buffer.from(s, "base64"); buf[buf.length - 1] ^= 1;
  assert.throws(() => unseal(buf.toString("base64")));
});

test("recovery codes are unique and hash ignoring dashes and case", () => {
  const c = newRecoveryCodes();
  assert.equal(new Set(c).size, 10);
  assert.equal(codeHash(c[0]), codeHash(c[0].replace("-", "").toLowerCase()));
});

test("cidr allow list", () => {
  assert.ok(allowed("1.2.3.4", []));
  assert.ok(allowed("10.1.2.3", ["10.0.0.0/8"]));
  assert.ok(!allowed("11.1.2.3", ["10.0.0.0/8"]));
  assert.ok(allowed("::ffff:192.168.1.5", ["192.168.1.0/24"]));
  assert.ok(allowed("203.0.113.9", ["203.0.113.9"]));
  assert.ok(!allowed("203.0.113.10", ["203.0.113.9"]));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession, credentials, destroySession, getSession } from "./session.js";

test("session round-trips credentials and can be destroyed", () => {
  const s = createSession("a@example.org", "pässword!");
  assert.deepEqual(credentials(getSession(s.id)!), { user: "a@example.org", pass: "pässword!" });
  assert.ok(!s.secret.toString("utf8").includes("ssword"));
  destroySession(s.id);
  assert.equal(getSession(s.id), undefined);
});

test("an empty SESSION_SECRET does not produce a predictable key", async () => {
  process.env.SESSION_SECRET = "";
  const spec = (n: string) => `./session.js?${n}`; // distinct URLs give distinct module instances (own random key)
  const a: typeof import("./session.js") = await import(spec("empty1"));
  const b: typeof import("./session.js") = await import(spec("empty2"));
  const s = a.createSession("x@example.org", "pw");
  // a different process-level random key means the other module instance cannot read it
  assert.throws(() => b.credentials(s));
  delete process.env.SESSION_SECRET;
});

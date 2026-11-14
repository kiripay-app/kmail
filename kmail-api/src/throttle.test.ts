import assert from "node:assert/strict";
import { test } from "node:test";
import { Throttle } from "./throttle.js";

test("blocks after max failures and recovers after the window", () => {
  const t = new Throttle(3, 1000);
  for (let i = 0; i < 3; i++) { assert.ok(!t.blocked("a", i)); t.fail("a", i); }
  assert.ok(t.blocked("a", 10));
  assert.ok(!t.blocked("b", 10), "other keys unaffected");
  assert.ok(!t.blocked("a", 1500), "window has passed");
});
test("clear resets, sweep frees memory", () => {
  const t = new Throttle(1, 1000);
  t.fail("a", 0); t.clear("a"); assert.ok(!t.blocked("a", 1));
  t.fail("x", 0); t.sweep(5000); assert.equal(t.size, 0);
});

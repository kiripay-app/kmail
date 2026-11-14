import assert from "node:assert/strict";
import { test } from "node:test";
import { parseAliases, parseMailboxes } from "./bulk.js";

test("mailbox list: comments, duplicates, names, quotas and bad lines", () => {
  const r = parseMailboxes("# accounts\nKarotu@PUB.com.ki,Karotu Tannang,4096\n\nkarotu@pub.com.ki\nbad address\nx@pub.com.ki,X,notanumber\nsales@pub.com.ki");
  assert.deepEqual(r.ok.map((m) => [m.address, m.name, m.quotaMiB]), [["karotu@pub.com.ki", "Karotu Tannang", 4096], ["sales@pub.com.ki", "", undefined]]);
  assert.equal(r.errors.length, 2);
});
test("alias list accepts ; or space separated destinations", () => {
  const r = parseAliases("info@pub.com.ki,a@pub.com.ki;b@pub.com.ki\nsales@pub.com.ki,c@pub.com.ki d@pub.com.ki\nbroken,nobody");
  assert.deepEqual(r.ok.map((a) => a.goto), ["a@pub.com.ki,b@pub.com.ki", "c@pub.com.ki,d@pub.com.ki"]);
  assert.equal(r.errors.length, 1);
});

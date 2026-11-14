import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCard, parseCard, updateCard } from "./vcard.js";

test("vCard round-trips and update preserves unknown properties", () => {
  const card = buildCard({ firstName: "Teitibwebwe", lastName: "Kaberiera", emails: ["t@pub.com.ki"], phones: ["+686 21000"], org: "PUB", notes: "n" }, "uid-1");
  const c = parseCard(card)!;
  assert.deepEqual([c.name, c.firstName, c.lastName, c.emails, c.phones, c.org, c.notes], ["Teitibwebwe Kaberiera", "Teitibwebwe", "Kaberiera", ["t@pub.com.ki"], ["+686 21000"], "PUB", "n"]);
  const out = updateCard(card.replace("END:VCARD", "X-ABC:keep\r\nEND:VCARD"), { firstName: "T", lastName: "K", emails: ["a@b.co", "c@d.co"], phones: [] });
  assert.match(out, /X-ABC:keep/);
  assert.deepEqual(parseCard(out)!.emails, ["a@b.co", "c@d.co"]);
  assert.equal(parseCard(out)!.phones.length, 0);
});
test("garbage vCard does not throw", () => assert.equal(parseCard("not a vcard"), undefined));

import { splitCards } from "./vcard.js";
test("vcf import splits many cards, adds missing UID and FN", () => {
  const vcf = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:A One\r\nUID:u1\r\nEND:VCARD\r\nBEGIN:VCARD\r\nVERSION:3.0\r\nN:Two;B;;;\r\nEND:VCARD\r\njunk";
  const out = splitCards(vcf);
  assert.equal(out.length, 2);
  assert.equal(out[0].uid, "u1");
  assert.ok(out[1].uid.length > 10);
  assert.match(out[1].data, /FN:/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanHtml } from "./sanitize.js";

test("strips scripts and handlers", () => {
  const { html } = cleanHtml('<p onclick="x()">hi</p><script>alert(1)</script><iframe src="//e"></iframe>', false);
  assert.equal(html, "<p>hi</p>");
});
test("blocks remote images by default and reports it", () => {
  const r = cleanHtml('<img src="https://t.example/p.gif">', false);
  assert.ok(!r.html.includes("t.example"));
  assert.equal(r.blockedRemote, true);
});
test("allows remote images when asked, keeps data images", () => {
  assert.ok(cleanHtml('<img src="https://t.example/p.gif">', true).html.includes("t.example"));
  assert.ok(cleanHtml('<img src="data:image/png;base64,AAAA">', false).html.includes("data:image/png"));
});
test("rejects javascript: links and adds rel/target", () => {
  assert.ok(!cleanHtml('<a href="javascript:alert(1)">x</a>', false).html.includes("javascript"));
  const h = cleanHtml('<a href="https://a.example">x</a>', false).html;
  assert.ok(h.includes('rel="noopener noreferrer nofollow"') && h.includes('target="_blank"'));
});

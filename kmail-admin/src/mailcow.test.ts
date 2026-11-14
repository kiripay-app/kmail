import "./test-env.js";
import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import { MailcowAdmin } from "./adapters/mailcow.js";

const seen: { method: string; url: string; key: string; body: string }[] = [];
const srv = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c));
  req.on("end", () => {
    seen.push({ method: req.method!, url: req.url!, key: String(req.headers["x-api-key"]), body });
    const send = (o: unknown, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/api/v1/get/domain/all") return send([{ domain_name: "pub.com.ki", active: 1, description: "PUB", mboxes_in_domain: 3, max_num_mboxes_for_domain: 10, max_quota_for_domain: 5368709120, bytes_total: 1048576 }]);
    if (req.url === "/api/v1/get/mailbox/all") return send([{ username: "a@pub.com.ki", domain: "pub.com.ki", name: "A", active: 1, quota: 2147483648, quota_used: 3145728, messages: 7, last_imap_login: 0 }]);
    if (req.url === "/api/v1/get/dkim/pub.com.ki") return send({ dkim_txt: "v=DKIM1;p=ABC", dkim_selector: "dkim", length: "2048" });
    if (req.url === "/api/v1/get/dkim/none.ki") return send({});
    if (req.url === "/api/v1/get/alias/all") return send({ id: 4, address: "x@pub.com.ki", goto: "a@pub.com.ki", active: 1, domain: "pub.com.ki" });
    if (req.url === "/api/v1/add/mailbox" && body.includes("dup")) return send([{ type: "danger", msg: ["object_exists", "dup@pub.com.ki"] }]);
    if (req.url === "/api/v1/get/status/containers") return send({ "postfix-mailcow": { state: "running" }, "dovecot-mailcow": { state: "exited" } });
    if (req.url?.startsWith("/api/v1/add") || req.url?.startsWith("/api/v1/edit") || req.url?.startsWith("/api/v1/delete")) return send([{ type: "success", msg: "ok" }]);
    send({ error: "no" }, 404);
  });
});
await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
const port = (srv.address() as any).port;
const mc = new MailcowAdmin({ url: `http://127.0.0.1:${port}/api/v1`, key: "KEY123", rejectUnauthorized: true });

test("reads convert bytes to MiB and accept bare objects", async () => {
  const d = (await mc.listDomains())[0];
  assert.deepEqual([d.name, d.quotaMiB, d.usedMiB, d.mailboxes, d.active], ["pub.com.ki", 5120, 1, 3, true]);
  const m = (await mc.listMailboxes())[0];
  assert.deepEqual([m.quotaMiB, m.usedMiB, m.messages, m.lastLogin], [2048, 3, 7, null]);
  assert.deepEqual(await mc.listAliases(), [{ id: "4", address: "x@pub.com.ki", goto: "a@pub.com.ki", active: true }]);
  assert.equal(seen.at(-1)!.key, "KEY123");
});

test("writes send MiB and the right shapes", async () => {
  await mc.addMailbox({ localPart: "n", domain: "pub.com.ki", password: "pw-pw-pw-pw-pw", quotaMiB: 1024 });
  const add = JSON.parse(seen.at(-1)!.body);
  assert.equal(add.quota, 1024); assert.equal(add.password2, add.password);
  await mc.deleteMailbox("n@pub.com.ki");
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), ["n@pub.com.ki"]);
  await mc.flushQueue(); assert.deepEqual(JSON.parse(seen.at(-1)!.body), { action: "flush" });
  await mc.clearQueue(); assert.deepEqual(JSON.parse(seen.at(-1)!.body), { action: "super_delete" });
  await mc.updateMailbox("a@pub.com.ki", { active: false, quotaMiB: 500 });
  assert.deepEqual(JSON.parse(seen.at(-1)!.body), { items: ["a@pub.com.ki"], attr: { quota: 500, active: 0 } });
});

test("failures reported inside a 200 become errors", async () => {
  await assert.rejects(mc.addMailbox({ localPart: "dup", domain: "pub.com.ki", password: "pw-pw-pw-pw-pw", quotaMiB: 1 }), /object_exists/);
});

test("dkim present and absent; health lists containers", async () => {
  assert.equal((await mc.getDkim("pub.com.ki"))!.length, 2048);
  assert.equal(await mc.getDkim("none.ki"), null);
  const h = await mc.health();
  assert.deepEqual(h.map((x) => [x.name, x.ok]), [["postfix", true], ["dovecot", false]]);
});

test("unreachable server gives a clean error", async () => {
  const bad = new MailcowAdmin({ url: "http://127.0.0.1:1/api/v1", key: "k", rejectUnauthorized: true });
  await assert.rejects(bad.listDomains(), /Cannot reach/);
  srv.close();
});

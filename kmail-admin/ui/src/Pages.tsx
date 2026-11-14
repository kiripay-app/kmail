import { Badge, Button, Field, Input, Select, Subtitle2, Switch, Textarea, Title3 } from "@fluentui/react-components";
import { useState } from "react";
import { del, get, patch, post } from "./api";
import { Confirm, fmtDate, fmtMiB, fmtUsed, Grid, Notice, useLoad } from "./ui";

const row: React.CSSProperties = { display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap", margin: "12px 0" };

/** Runs an action, reloads, and shows the result or error. */
function useDo(reload: () => void) {
  const [err, setErr] = useState(""), [ok, setOk] = useState("");
  const run = async (fn: () => Promise<any>, msg = "Done.") => {
    setErr(""); setOk("");
    try { const r = await fn(); setOk(r?.generatedPassword ? `${msg} Password (shown once): ${r.generatedPassword}` : r?.temporaryPassword ? `${msg} Temporary password (shown once): ${r.temporaryPassword}` : msg); reload(); return r; }
    catch (e: any) { setErr(e.message); }
  };
  return { err, ok, run };
}

export function Health() {
  const { data, err } = useLoad(() => get("/health"));
  return (<div><Title3>Overview</Title3><Notice err={err} />
    {data && <><p>Backend: <b>{data.backend}</b></p>
      <Grid cols={["Service", "Status"]} rows={data.items.map((i: any) => [i.name, <Badge color={i.ok ? "success" : "danger"}>{i.ok ? "running" : i.detail}</Badge>])} empty="No health information." /></>}
  </div>);
}

export function Domains() {
  const { data, err, reload } = useLoad<any[]>(() => get("/domains"));
  const [name, setName] = useState(""), [desc, setDesc] = useState(""), [quota, setQuota] = useState("5120");
  const d = useDo(reload);
  return (<div><Title3>Domains</Title3><Notice err={err || d.err} ok={d.ok} />
    <div style={row}>
      <Field label="Domain"><Input value={name} onChange={(_, x) => setName(x.value)} placeholder="pub.com.ki" /></Field>
      <Field label="Description"><Input value={desc} onChange={(_, x) => setDesc(x.value)} /></Field>
      <Field label="Quota (MB, 0 = unlimited)"><Input value={quota} onChange={(_, x) => setQuota(x.value)} inputMode="numeric" /></Field>
      <Button appearance="primary" disabled={!name} onClick={() => d.run(async () => { await post("/domains", { name, description: desc, quotaMiB: Number(quota) || 0 }); setName(""); setDesc(""); }, "Domain added.")}>Add domain</Button>
    </div>
    <Grid cols={["Domain", "Description", "Mailboxes", "Quota", "Active", ""]} rows={(data ?? []).map((x) => [
      x.name, x.description, `${x.mailboxes}/${x.maxMailboxes}`, `${fmtUsed(x.usedMiB)} of ${fmtMiB(x.quotaMiB)}`,
      <Switch checked={x.active} onChange={(_, s) => d.run(() => patch(`/domains/${x.name}`, { active: s.checked }), "Saved.")} aria-label={`${x.name} active`} />,
      <Confirm label="Delete" title={`Delete ${x.name}?`} text="The domain and all its mail will be removed. This cannot be undone." onYes={() => d.run(() => del(`/domains/${x.name}`), "Domain deleted.")} />])} /></div>);
}

export function Mailboxes() {
  const doms = useLoad<any[]>(() => get("/domains"));
  const [filter, setFilter] = useState("");
  const { data, err, reload } = useLoad<any[]>(() => get(`/mailboxes${filter ? `?domain=${filter}` : ""}`), [filter]);
  const [lp, setLp] = useState(""), [dom, setDom] = useState(""), [nm, setNm] = useState(""), [quota, setQuota] = useState("2048");
  const d = useDo(reload);
  const domain = dom || doms.data?.[0]?.name || "";
  return (<div><Title3>Mailboxes</Title3><Notice err={err || d.err} ok={d.ok} />
    <div style={row}>
      <Field label="Name"><Input value={nm} onChange={(_, x) => setNm(x.value)} /></Field>
      <Field label="Address"><Input value={lp} onChange={(_, x) => setLp(x.value)} placeholder="name" /></Field>
      <Field label="Domain"><Select value={domain} onChange={(_, x) => setDom(x.value)}>{(doms.data ?? []).map((x) => <option key={x.name}>{x.name}</option>)}</Select></Field>
      <Field label="Quota (MB)"><Input value={quota} onChange={(_, x) => setQuota(x.value)} inputMode="numeric" style={{ width: 100 }} /></Field>
      <Button appearance="primary" disabled={!lp || !domain} onClick={() => d.run(async () => { const r = await post("/mailboxes", { localPart: lp, domain, name: nm, quotaMiB: Number(quota) || 0 }); setLp(""); setNm(""); return r; }, `Created ${lp}@${domain}.`)}>Create (random password)</Button>
    </div>
    <Field label="Show domain" style={{ maxWidth: 240 }}><Select value={filter} onChange={(_, x) => setFilter(x.value)}><option value="">All</option>{(doms.data ?? []).map((x) => <option key={x.name}>{x.name}</option>)}</Select></Field>
    <Grid cols={["Mailbox", "Name", "Used", "Messages", "Last login", "Active", ""]} rows={(data ?? []).map((x) => [
      x.address, x.name, `${fmtUsed(x.usedMiB)} of ${fmtMiB(x.quotaMiB)}`, x.messages, x.lastLogin ? fmtDate(x.lastLogin * 1000) : "never",
      <Switch checked={x.active} onChange={(_, s) => d.run(() => patch(`/mailboxes/${x.address}`, { active: s.checked }), "Saved.")} aria-label={`${x.address} active`} />,
      <span style={{ display: "flex", gap: 4 }}>
        <Confirm label="Reset password" danger={false} title={`Reset password for ${x.address}?`} text="A new random password is generated and shown once. Their old password stops working." onYes={() => d.run(() => patch(`/mailboxes/${x.address}`, { resetPassword: true }), "Password reset.")} />
        <Confirm label="Delete" title={`Delete ${x.address}?`} text="The mailbox and all its mail will be deleted. This cannot be undone." onYes={() => d.run(() => del(`/mailboxes/${x.address}`), "Mailbox deleted.")} /></span>])} /></div>);
}

export function Aliases() {
  const { data, err, reload } = useLoad<any[]>(() => get("/aliases"));
  const [addr, setAddr] = useState(""), [to, setTo] = useState("");
  const d = useDo(reload);
  return (<div><Title3>Aliases</Title3><Notice err={err || d.err} ok={d.ok} />
    <div style={row}>
      <Field label="Alias address"><Input value={addr} onChange={(_, x) => setAddr(x.value)} placeholder="info@pub.com.ki" /></Field>
      <Field label="Forward to (comma separated)"><Input value={to} onChange={(_, x) => setTo(x.value)} style={{ width: 300 }} /></Field>
      <Button appearance="primary" disabled={!addr || !to} onClick={() => d.run(async () => { await post("/aliases", { address: addr, goto: to }); setAddr(""); setTo(""); }, "Alias added.")}>Add alias</Button>
    </div>
    <Grid cols={["Alias", "Goes to", "Active", ""]} rows={(data ?? []).map((x) => [x.address, x.goto,
      <Switch checked={x.active} onChange={(_, s) => d.run(() => patch(`/aliases/${x.id}`, { active: s.checked }), "Saved.")} aria-label={`${x.address} active`} />,
      <Confirm label="Delete" title={`Delete ${x.address}?`} text="Mail sent to this alias will bounce." onYes={() => d.run(() => del(`/aliases/${x.id}`), "Alias deleted.")} />])} /></div>);
}

export function Dkim() {
  const doms = useLoad<any[]>(() => get("/domains"));
  const [sel, setSel] = useState("");
  const domain = sel || doms.data?.[0]?.name || "";
  const { data, err, reload } = useLoad<any>(() => (domain ? get(`/dkim/${domain}`) : Promise.resolve({ dkim: null })), [domain]);
  const [bits, setBits] = useState("2048");
  const d = useDo(reload);
  const k = data?.dkim;
  return (<div><Title3>DKIM signing keys</Title3><Notice err={err || d.err} ok={d.ok} />
    <Field label="Domain" style={{ maxWidth: 300 }}><Select value={domain} onChange={(_, x) => setSel(x.value)}>{(doms.data ?? []).map((x) => <option key={x.name}>{x.name}</option>)}</Select></Field>
    {domain && !k && <div style={row}>
      <p>No key yet for {domain}.</p>
      <Select value={bits} onChange={(_, x) => setBits(x.value)} aria-label="Key size"><option>1024</option><option>2048</option><option>4096</option></Select>
      <Button appearance="primary" onClick={() => d.run(() => post(`/dkim/${domain}`, { selector: "dkim", bits: Number(bits) }), "Key created.")}>Create key</Button></div>}
    {k && <><Subtitle2>Publish this DNS TXT record</Subtitle2>
      <p>Name: <code>{k.selector}._domainkey.{domain}</code> ({k.length}-bit)</p>
      <Textarea readOnly value={k.txt} rows={5} style={{ width: "100%", maxWidth: 700 }} aria-label="DKIM TXT value" />
      <div style={row}><Button onClick={() => navigator.clipboard?.writeText(k.txt)}>Copy value</Button>
        <Confirm label="Delete key" title="Delete the DKIM key?" text="Outgoing mail will no longer be signed until you create a new key and update DNS." onYes={() => d.run(() => del(`/dkim/${domain}`), "Key deleted.")} /></div></>}
  </div>);
}

export function Queue() {
  const { data, err, reload } = useLoad<any[]>(() => get("/queue"));
  const d = useDo(reload);
  return (<div><Title3>Mail queue</Title3><Notice err={err || d.err} ok={d.ok} />
    <div style={row}><Button onClick={reload}>Refresh</Button>
      <Button onClick={() => d.run(() => post("/queue/flush"), "Delivery retry requested.")}>Retry all now</Button>
      <Confirm label="Delete all queued mail" title="Delete everything in the queue?" text="Queued messages are discarded and senders are not told. Use this only for spam floods." onYes={() => d.run(() => post("/queue/clear", { confirm: true }), "Queue cleared.")} /></div>
    <Grid cols={["ID", "From", "To", "Size", "Queued"]} rows={(data ?? []).map((x) => [x.id, x.sender, x.recipients.join(", "), `${Math.ceil(x.size / 1024)} KB`, fmtDate(x.arrival * 1000)])} empty="The queue is empty." /></div>);
}

export function Logs() {
  const [kind, setKind] = useState("postfix");
  const { data, err, reload } = useLoad<any>(() => get(`/logs/${kind}?count=200`), [kind]);
  return (<div><Title3>Logs</Title3><Notice err={err} />
    <div style={row}><Select value={kind} onChange={(_, x) => setKind(x.value)} aria-label="Log"><option value="postfix">Postfix (sending)</option><option value="dovecot">Dovecot (mailboxes)</option><option value="auth">Blocked logins</option></Select><Button onClick={reload}>Refresh</Button></div>
    <pre style={{ background: "#faf9f8", padding: 12, overflow: "auto", maxHeight: "60vh", fontSize: 12 }}>{(data?.lines ?? []).join("\n") || "No entries."}</pre></div>);
}

export function Audit() {
  const { data, err, reload } = useLoad<any[]>(() => get("/audit?limit=200"));
  return (<div><Title3>Audit log</Title3><Notice err={err} />
    <p style={{ color: "#605e5c" }}>Every sign-in and change made through this panel. Entries cannot be edited or deleted.</p><Button onClick={reload}>Refresh</Button>
    <Grid cols={["When", "Who", "From", "Action", "Target", "Result", "Detail"]} rows={(data ?? []).map((x) => [fmtDate(x.ts), x.actor, x.ip, x.action, x.target,
      <Badge color={x.ok ? "success" : "danger"}>{x.ok ? "ok" : "failed"}</Badge>, <span style={{ wordBreak: "break-all" }}>{x.detail}</span>])} /></div>);
}

export function Admins({ me }: { me: string }) {
  const { data, err, reload } = useLoad<any[]>(() => get("/admins"));
  const [u, setU] = useState("");
  const d = useDo(reload);
  return (<div><Title3>Administrators</Title3><Notice err={err || d.err} ok={d.ok} />
    <div style={row}><Field label="New administrator username"><Input value={u} onChange={(_, x) => setU(x.value)} /></Field>
      <Button appearance="primary" disabled={!u} onClick={() => d.run(async () => { const r = await post("/admins", { username: u }); setU(""); return r; }, `Created ${u}.`)}>Create</Button></div>
    <Grid cols={["Username", "2-step", "Status", "Last sign-in", ""]} rows={(data ?? []).map((x) => [x.username + (x.username === me ? " (you)" : ""),
      <Badge color={x.totp ? "success" : "warning"}>{x.totp ? "on" : "not set up"}</Badge>,
      x.disabled ? <Badge color="danger">disabled</Badge> : x.locked ? <Badge color="warning">locked</Badge> : <Badge color="success">active</Badge>,
      fmtDate(x.lastLogin),
      x.username === me ? "" : <span style={{ display: "flex", gap: 4 }}>
        <Confirm label="Reset" danger={false} title={`Reset ${x.username}?`} text="Sets a new temporary password, turns off their two-step verification and signs them out. They must set it up again." onYes={() => d.run(() => post(`/admins/${x.id}/reset`), "Reset.")} />
        {x.disabled ? <Button size="small" onClick={() => d.run(() => post(`/admins/${x.id}/enable`), "Enabled.")}>Enable</Button>
          : <Confirm label="Disable" title={`Disable ${x.username}?`} text="They are signed out and cannot sign in." onYes={() => d.run(() => post(`/admins/${x.id}/disable`), "Disabled.")} />}
        <Confirm label="Delete" title={`Delete ${x.username}?`} text="This removes the administrator permanently." onYes={() => d.run(() => del(`/admins/${x.id}`), "Deleted.")} /></span>])} /></div>);
}

export function Account() {
  const [cur, setCur] = useState(""), [nw, setNw] = useState(""), [code, setCode] = useState(""), [codes, setCodes] = useState<string[]>();
  const p = useDo(() => {}), r = useDo(() => {});
  return (<div><Title3>My account</Title3>
    <Subtitle2>Change password</Subtitle2><Notice err={p.err} ok={p.ok} />
    <div style={row}><Field label="Current password"><Input type="password" value={cur} onChange={(_, x) => setCur(x.value)} autoComplete="current-password" /></Field>
      <Field label="New password (12+ characters)"><Input type="password" value={nw} onChange={(_, x) => setNw(x.value)} autoComplete="new-password" /></Field>
      <Button appearance="primary" disabled={!cur || !nw} onClick={() => p.run(async () => { await post("/account/password", { current: cur, next: nw }); setCur(""); setNw(""); }, "Password changed.")}>Change</Button></div>
    <Subtitle2>New recovery codes</Subtitle2><Notice err={r.err} />
    <p style={{ color: "#605e5c" }}>Replaces all your old codes. Enter a current authenticator code to confirm.</p>
    <div style={row}><Field label="Authenticator code"><Input value={code} onChange={(_, x) => setCode(x.value)} inputMode="numeric" /></Field>
      <Button disabled={code.length < 6} onClick={async () => { const x = await r.run(() => post("/account/recovery", { code })); if (x) { setCodes(x.recoveryCodes); setCode(""); } }}>Generate</Button></div>
    {codes && <pre style={{ background: "#faf9f8", padding: 12, fontSize: 16, lineHeight: 1.6, width: "fit-content" }}>{codes.join("\n")}</pre>}</div>);
}

import { Body1, Button, Card, Field, Input, MessageBar, MessageBarBody, Spinner, Subtitle1, Title2 } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { get, post } from "./api";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100%", display: "grid", placeItems: "center", background: "#f3f2f1", padding: 16 }}>
      <Card style={{ width: 380, maxWidth: "100%", padding: 24, gap: 12 }}>
        <Title2>KMail Admin</Title2>
        {children}
      </Card>
    </div>
  );
}
const Err = ({ msg }: { msg: string }) => (msg ? <MessageBar intent="error"><MessageBarBody>{msg}</MessageBarBody></MessageBar> : null);

export function Login({ onDone }: { onDone: (stage: string) => void }) {
  const [u, setU] = useState(""), [p, setP] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr("");
    try { onDone((await post("/login", { username: u, password: p })).stage); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <Subtitle1>Sign in</Subtitle1>
      <Err msg={err} />
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ display: "grid", gap: 12 }}>
        <Field label="Username"><Input value={u} onChange={(_, d) => setU(d.value)} autoComplete="username" autoFocus /></Field>
        <Field label="Password"><Input type="password" value={p} onChange={(_, d) => setP(d.value)} autoComplete="current-password" /></Field>
        <Button appearance="primary" type="submit" disabled={busy || !u || !p}>{busy ? <Spinner size="tiny" /> : "Continue"}</Button>
      </form>
    </Shell>
  );
}

export function TotpStep({ onDone, onCancel }: { onDone: (r: any) => void; onCancel: () => void }) {
  const [code, setCode] = useState(""), [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr("");
    try { onDone(await post("/login/totp", { code })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <Subtitle1>Two-step verification</Subtitle1>
      <Body1>Enter the 6-digit code from your authenticator app. Lost your phone? Use one of your recovery codes instead.</Body1>
      <Err msg={err} />
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ display: "grid", gap: 12 }}>
        <Field label="Code"><Input value={code} onChange={(_, d) => setCode(d.value)} autoComplete="one-time-code" inputMode="text" autoFocus /></Field>
        <Button appearance="primary" type="submit" disabled={busy || code.length < 6}>Verify</Button>
        <Button appearance="subtle" onClick={onCancel}>Back</Button>
      </form>
    </Shell>
  );
}

export function Setup({ onDone }: { onDone: () => void }) {
  const [info, setInfo] = useState<any>(), [code, setCode] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState(""), [err, setErr] = useState(""), [codes, setCodes] = useState<string[]>();
  useEffect(() => { get("/setup").then(setInfo).catch((e) => setErr(e.message)); }, []);
  if (codes) return (
    <Shell>
      <Subtitle1>Save your recovery codes</Subtitle1>
      <Body1>Each code works once if you lose your phone. They will not be shown again. Store them somewhere safe, not on the same phone.</Body1>
      <pre style={{ background: "#faf9f8", padding: 12, margin: 0, fontSize: 16, lineHeight: 1.6 }}>{codes.join("\n")}</pre>
      <Button onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy</Button>
      <Button appearance="primary" onClick={onDone}>I have saved them</Button>
    </Shell>
  );
  if (!info) return <Shell>{err ? <Err msg={err} /> : <Spinner />}</Shell>;
  const go = async () => {
    setErr("");
    if (info.mustChangePassword && pw !== pw2) return setErr("The two passwords do not match");
    try { setCodes((await post("/setup", { code, password: info.mustChangePassword ? pw : undefined })).recoveryCodes); } catch (e: any) { setErr(e.message); }
  };
  return (
    <Shell>
      <Subtitle1>First sign-in setup</Subtitle1>
      <Err msg={err} />
      <form onSubmit={(e) => { e.preventDefault(); void go(); }} style={{ display: "grid", gap: 12 }}>
        {info.mustChangePassword && <>
          <Field label="New password" hint="At least 12 characters"><Input type="password" value={pw} onChange={(_, d) => setPw(d.value)} autoComplete="new-password" /></Field>
          <Field label="Repeat new password"><Input type="password" value={pw2} onChange={(_, d) => setPw2(d.value)} autoComplete="new-password" /></Field>
        </>}
        <Body1>Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis, 1Password...).</Body1>
        <img src={info.qr} alt="QR code for authenticator app" width={220} height={220} style={{ justifySelf: "center" }} />
        <Body1>Cannot scan? Enter this key: <code style={{ wordBreak: "break-all" }}>{info.secret}</code></Body1>
        <Field label="6-digit code from the app"><Input value={code} onChange={(_, d) => setCode(d.value)} inputMode="numeric" autoComplete="one-time-code" /></Field>
        <Button appearance="primary" type="submit" disabled={code.length < 6}>Turn on two-step verification</Button>
      </form>
    </Shell>
  );
}

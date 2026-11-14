import { useRef, useState } from "react";
import { Button, Field, Input, MessageBar, MessageBarBody, Textarea } from "@fluentui/react-components";
import { Attach24Regular, Dismiss24Regular, Send24Regular } from "@fluentui/react-icons";
import { api } from "./api";

export interface Prefill { to?: string; cc?: string; subject?: string; body?: string }

const split = (s: string) => s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOTAL = 25 * 1024 * 1024;

function toBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export function Compose({ prefill, onClose, onSent }: { prefill: Prefill; onClose: () => void; onSent: () => void }) {
  const [to, setTo] = useState(prefill.to ?? "");
  const [cc, setCc] = useState(prefill.cc ?? "");
  const [showCc, setShowCc] = useState(Boolean(prefill.cc));
  const [subject, setSubject] = useState(prefill.subject ?? "");
  const [text, setText] = useState(prefill.body ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function send() {
    const toList = split(to), ccList = split(cc);
    const bad = [...toList, ...ccList].find((a) => !EMAIL.test(a));
    if (!toList.length) return setError("Add at least one recipient.");
    if (bad) return setError(`"${bad}" is not a valid email address.`);
    if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) return setError("Attachments are over 25 MB in total.");
    setBusy(true);
    setError("");
    try {
      await api.send({
        to: toList, cc: ccList, bcc: [], subject, text,
        attachments: await Promise.all(files.map(async (f) => ({ filename: f.name, contentType: f.type || undefined, base64: await toBase64(f) }))),
      });
      onSent();
    } catch {
      setError("The message could not be sent. Check the addresses and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="dialog" aria-label="New message" style={{ position: "fixed", right: 24, bottom: 0, width: 560, maxWidth: "calc(100vw - 48px)", background: "#fff", border: "1px solid #d1d1d1", borderRadius: "8px 8px 0 0", boxShadow: "0 8px 32px rgba(0,0,0,.25)", display: "grid", gridTemplateRows: "auto 1fr auto", maxHeight: "85vh", zIndex: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "#0f6cbd", color: "#fff", borderRadius: "8px 8px 0 0" }}>
        <strong>{prefill.subject ? prefill.subject : "New message"}</strong>
        <Button appearance="transparent" icon={<Dismiss24Regular style={{ color: "#fff" }} />} onClick={onClose} aria-label="Discard" />
      </div>
      <div style={{ padding: 12, display: "grid", gap: 8, overflow: "auto" }}>
        {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
        <Field label="To" hint="Separate addresses with commas">
          <Input value={to} onChange={(_, d) => setTo(d.value)} contentAfter={!showCc ? <Button size="small" appearance="transparent" onClick={() => setShowCc(true)}>Cc</Button> : undefined} />
        </Field>
        {showCc && <Field label="Cc"><Input value={cc} onChange={(_, d) => setCc(d.value)} /></Field>}
        <Field label="Subject"><Input value={subject} onChange={(_, d) => setSubject(d.value)} /></Field>
        <Textarea aria-label="Message" resize="vertical" rows={10} value={text} onChange={(_, d) => setText(d.value)} />
        {files.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {files.map((f, i) => (
              <Button key={i} size="small" icon={<Dismiss24Regular />} iconPosition="after" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                {f.name} ({Math.ceil(f.size / 1024)} KB)
              </Button>
            ))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, padding: 12, borderTop: "1px solid #e0e0e0" }}>
        <Button appearance="primary" icon={<Send24Regular />} onClick={send} disabled={busy}>{busy ? "Sending…" : "Send"}</Button>
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
        <Button icon={<Attach24Regular />} onClick={() => fileInput.current?.click()}>Attach</Button>
      </div>
    </div>
  );
}

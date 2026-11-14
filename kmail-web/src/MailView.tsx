import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Input, MessageBar, MessageBarBody, Spinner, Text, Toolbar, ToolbarDivider } from "@fluentui/react-components";
import {
  ArrowForward24Regular, ArrowReply24Regular, ArrowReplyAll24Regular, Delete24Regular, DocumentEdit24Regular, Flag24Filled, Flag24Regular,
  Folder24Regular, Mail24Regular, MailInbox24Regular, MailUnread24Regular, Search24Regular, Send24Regular, Warning24Regular,
} from "@fluentui/react-icons";
import { Addr, api, AuthError, Folder, MsgDetail, MsgSummary } from "./api";
import { Compose, Prefill } from "./Compose";

const folderIcon = (f: Folder) =>
  f.specialUse === "\\Inbox" ? <MailInbox24Regular /> : f.specialUse === "\\Sent" ? <Send24Regular /> : f.specialUse === "\\Drafts" ? <DocumentEdit24Regular />
  : f.specialUse === "\\Trash" ? <Delete24Regular /> : f.specialUse === "\\Junk" ? <Warning24Regular /> : <Folder24Regular />;

const fmtAddr = (a: Addr) => (a.name ? `${a.name} <${a.address}>` : a.address);
const short = (a: Addr) => a.name || a.address || "(unknown)";
function fmtDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso), now = new Date();
  return d.toDateString() === now.toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
const htmlToText = (html: string) => new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
const quote = (d: MsgDetail) => `\n\nOn ${d.date ? new Date(d.date).toLocaleString() : ""}, ${d.from.map(short).join(", ")} wrote:\n` + htmlToText(d.html).trim().split("\n").map((l) => `> ${l}`).join("\n");
const rePrefix = (s: string, p: string) => (new RegExp(`^${p}:`, "i").test(s) ? s : `${p}: ${s}`);

export function MailView({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState("INBOX");
  const [list, setList] = useState<MsgSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [uid, setUid] = useState<number | null>(null);
  const [detail, setDetail] = useState<MsgDetail | null>(null);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [images, setImages] = useState(false);
  const [error, setError] = useState("");
  const [compose, setCompose] = useState<Prefill | null>(null);
  const listReq = useRef(0);

  const fail = useCallback((e: unknown) => {
    if (e instanceof AuthError) onSignedOut();
    else setError("Something went wrong talking to the mail server.");
  }, [onSignedOut]);

  const loadFolders = useCallback(() => api.folders().then(setFolders).catch(fail), [fail]);
  const loadList = useCallback(async () => {
    const my = ++listReq.current;
    setLoadingList(true);
    try {
      const r = await api.messages(folder, page, activeSearch);
      if (my === listReq.current) { setList(r.messages); setTotal(r.total); setError(""); }
    } catch (e) { fail(e); } finally { if (my === listReq.current) setLoadingList(false); }
  }, [folder, page, activeSearch, fail]);

  useEffect(() => { loadFolders(); }, [loadFolders]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { const t = setInterval(() => { loadFolders(); if (page === 1 && !activeSearch) loadList(); }, 60_000); return () => clearInterval(t); }, [loadFolders, loadList, page, activeSearch]);

  useEffect(() => {
    if (uid === null) { setDetail(null); return; }
    let cancelled = false;
    setLoadingMsg(true);
    api.message(folder, uid, images).then((d) => {
      if (cancelled) return;
      setDetail(d);
      setList((l) => l.map((m) => (m.uid === uid ? { ...m, seen: true } : m)));
      loadFolders();
    }).catch(fail).finally(() => !cancelled && setLoadingMsg(false));
    return () => { cancelled = true; };
  }, [uid, folder, images, fail, loadFolders]);

  const selected = list.find((m) => m.uid === uid);
  const pickFolder = (p: string) => { setFolder(p); setPage(1); setUid(null); setImages(false); setSearch(""); setActiveSearch(""); };
  const pick = (m: MsgSummary) => { setImages(false); setUid(m.uid); };

  async function act(fn: () => Promise<unknown>, clear = false) {
    try { await fn(); if (clear) { setUid(null); } await Promise.all([loadList(), loadFolders()]); } catch (e) { fail(e); }
  }
  const replyTo = (all: boolean): Prefill | null => detail && ({
    to: detail.from.map((a) => a.address).join(", "),
    cc: all ? [...detail.to, ...detail.cc].map((a) => a.address).filter((a) => a && a.toLowerCase() !== email).join(", ") : undefined,
    subject: rePrefix(detail.subject, "Re"), body: quote(detail),
  });

  const pages = Math.max(1, Math.ceil(total / 50));
  const dis = !detail;

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto auto 1fr", height: "100%", minHeight: 0 }}>
      <Toolbar aria-label="Mail actions" style={{ padding: "6px 12px", borderBottom: "1px solid #e0e0e0", background: "#faf9f8", gap: 4, flexWrap: "wrap" }}>
        <Button appearance="primary" icon={<Mail24Regular />} onClick={() => setCompose({})}>New mail</Button>
        <ToolbarDivider />
        <Button appearance="subtle" icon={<Delete24Regular />} disabled={dis} onClick={() => act(() => api.remove(folder, uid!), true)}>Delete</Button>
        <Button appearance="subtle" icon={<ArrowReply24Regular />} disabled={dis} onClick={() => setCompose(replyTo(false))}>Reply</Button>
        <Button appearance="subtle" icon={<ArrowReplyAll24Regular />} disabled={dis} onClick={() => setCompose(replyTo(true))}>Reply all</Button>
        <Button appearance="subtle" icon={<ArrowForward24Regular />} disabled={dis} onClick={() => detail && setCompose({ subject: rePrefix(detail.subject, "Fwd"), body: `\n\n---------- Forwarded message ----------\nFrom: ${detail.from.map(fmtAddr).join(", ")}\nSubject: ${detail.subject}\n\n${htmlToText(detail.html).trim()}` })}>Forward</Button>
        <ToolbarDivider />
        <Button appearance="subtle" icon={<MailUnread24Regular />} disabled={dis} onClick={() => act(() => api.patch(folder, uid!, { seen: false }), true)}>Mark unread</Button>
        <Button appearance="subtle" icon={selected?.flagged ? <Flag24Filled style={{ color: "#c50f1f" }} /> : <Flag24Regular />} disabled={dis} onClick={() => act(() => api.patch(folder, uid!, { flagged: !selected?.flagged }))}>Flag</Button>
        <div style={{ flex: 1 }} />
        <form onSubmit={(e) => { e.preventDefault(); setPage(1); setUid(null); setActiveSearch(search.trim()); }}>
          <Input contentBefore={<Search24Regular />} placeholder="Search mail" value={search} onChange={(_, d) => { setSearch(d.value); if (!d.value) { setActiveSearch(""); setPage(1); } }} />
        </form>
      </Toolbar>
      {error ? <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar> : <div />}
      <div style={{ display: "grid", gridTemplateColumns: "220px 380px 1fr", minHeight: 0 }}>
        <nav aria-label="Folders" style={{ borderRight: "1px solid #e0e0e0", padding: "8px 0", overflow: "auto" }}>
          {folders.map((f) => (
            <button key={f.path} onClick={() => pickFolder(f.path)} aria-current={f.path === folder} style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "8px 16px", border: 0, textAlign: "left", cursor: "pointer", background: f.path === folder ? "#e6f0fa" : "transparent", fontWeight: f.unseen ? 600 : 400, borderLeft: f.path === folder ? "3px solid #0f6cbd" : "3px solid transparent", font: "inherit" }}>
              {folderIcon(f)}<span style={{ flex: 1 }}>{f.name}</span>{f.unseen > 0 && <span style={{ color: "#0f6cbd", fontWeight: 600 }}>{f.unseen}</span>}
            </button>
          ))}
        </nav>
        <section aria-label="Messages" style={{ borderRight: "1px solid #e0e0e0", display: "grid", gridTemplateRows: "1fr auto", minHeight: 0 }}>
          <div style={{ overflow: "auto" }}>
            {loadingList && !list.length && <div style={{ padding: 24 }}><Spinner /></div>}
            {!loadingList && !list.length && <Text style={{ display: "block", padding: 24, color: "#605e5c" }}>{activeSearch ? "No messages match your search." : "This folder is empty."}</Text>}
            {list.map((m) => (
              <button key={m.uid} onClick={() => pick(m)} aria-current={m.uid === uid} style={{ display: "block", width: "100%", textAlign: "left", padding: "10px 16px", border: 0, borderBottom: "1px solid #f0f0f0", cursor: "pointer", font: "inherit", background: m.uid === uid ? "#e6f0fa" : "transparent", borderLeft: m.seen ? "3px solid transparent" : "3px solid #0f6cbd" }}>
                <div style={{ display: "flex", gap: 8, fontWeight: m.seen ? 400 : 600 }}>
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{short(m.from)}</span>
                  {m.flagged && <Flag24Filled style={{ color: "#c50f1f", width: 16 }} />}
                  <span style={{ color: "#605e5c", fontWeight: 400, fontSize: 12 }}>{fmtDate(m.date)}</span>
                </div>
                <div style={{ fontWeight: m.seen ? 400 : 600, color: m.seen ? "#323130" : "#0f6cbd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.subject}</div>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", borderTop: "1px solid #e0e0e0", fontSize: 12, color: "#605e5c" }}>
            <span>{total} message{total === 1 ? "" : "s"}</span>
            <span>
              <Button size="small" appearance="subtle" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button>
              {page} / {pages}
              <Button size="small" appearance="subtle" disabled={page >= pages} onClick={() => setPage(page + 1)}>Older</Button>
            </span>
          </div>
        </section>
        <article aria-label="Reading pane" style={{ display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0, minWidth: 0 }}>
          {loadingMsg && !detail && <div style={{ padding: 24 }}><Spinner /></div>}
          {!detail && !loadingMsg && <Text style={{ padding: 32, color: "#605e5c" }}>Select a message to read it.</Text>}
          {detail && (<>
            <header style={{ padding: "16px 24px 8px", borderBottom: "1px solid #f0f0f0" }}>
              <Text as="h2" size={600} weight="semibold" style={{ display: "block", margin: 0, overflowWrap: "anywhere" }}>{detail.subject}</Text>
              <div style={{ marginTop: 8, color: "#605e5c", fontSize: 13, display: "grid", gap: 2 }}>
                <span><strong style={{ color: "#323130" }}>{detail.from.map(fmtAddr).join(", ")}</strong> · {detail.date ? new Date(detail.date).toLocaleString() : ""}</span>
                <span>To: {detail.to.map(short).join(", ")}{detail.cc.length ? ` · Cc: ${detail.cc.map(short).join(", ")}` : ""}</span>
              </div>
              {detail.attachments.length > 0 && (
                <div style={{ marginTop: 8, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {detail.attachments.map((a) => <a key={a.index} href={api.attachmentUrl(folder, detail.uid, a.index)} download style={{ padding: "4px 10px", border: "1px solid #d1d1d1", borderRadius: 4, fontSize: 13, textDecoration: "none", color: "#0f6cbd" }}>{a.filename} ({Math.ceil(a.size / 1024)} KB)</a>)}
                </div>
              )}
              {detail.blockedRemoteImages && !images && (
                <MessageBar style={{ marginTop: 8 }}><MessageBarBody>Pictures from the internet were blocked to protect your privacy. <Button size="small" appearance="transparent" style={{ color: "#0f6cbd", textDecoration: "underline" }} onClick={() => setImages(true)}>Show pictures</Button></MessageBarBody></MessageBar>
              )}
            </header>
            {/* Sandboxed: no scripts, no same-origin access; links may open in a new tab. */}
            <iframe title="Message body" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
              srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank"><style>body{font:14px system-ui,sans-serif;color:#242424;margin:16px 24px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}</style>${detail.html}`}
              style={{ border: 0, width: "100%", height: "100%", background: "#fff" }} />
          </>)}
        </article>
      </div>
      {compose && <Compose prefill={compose} onClose={() => setCompose(null)} onSent={() => { setCompose(null); loadFolders(); if (folder.toLowerCase().startsWith("sent")) loadList(); }} />}
    </div>
  );
}

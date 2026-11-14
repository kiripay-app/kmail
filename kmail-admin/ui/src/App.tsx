import { Button, Spinner, Tab, TabList } from "@fluentui/react-components";
import { useEffect, useState } from "react";
import { get, post } from "./api";
import { Login, Setup, TotpStep } from "./Auth";
import { Account, Admins, Aliases, Audit, Dkim, Domains, Health, Logs, Mailboxes, Queue } from "./Pages";

const PAGES = [["health", "Overview"], ["domains", "Domains"], ["mailboxes", "Mailboxes"], ["aliases", "Aliases"], ["dkim", "DKIM"], ["queue", "Queue"], ["logs", "Logs"], ["audit", "Audit"], ["admins", "Admins"], ["account", "Account"]] as const;

export default function App() {
  const [stage, setStage] = useState<string>("loading"), [me, setMe] = useState(""), [page, setPage] = useState<string>("health");
  const [recoveryNote, setNote] = useState("");

  const refresh = async () => {
    try { const r = await get("/me"); setStage(r.stage); setMe(r.username); } catch { setStage("out"); }
  };
  useEffect(() => { void refresh(); }, []);

  if (stage === "loading") return <Spinner style={{ marginTop: 80 }} />;
  if (stage === "out") return <Login onDone={(s) => { setStage(s); void refresh(); }} />;
  if (stage === "totp") return <TotpStep onDone={(r) => { if (r.usedRecovery) setNote(`You signed in with a recovery code. ${r.recoveryLeft} left. Generate new ones in Account.`); void refresh(); }} onCancel={async () => { await post("/logout"); setStage("out"); }} />;
  if (stage === "setup") return <Setup onDone={() => void refresh()} />;

  const Page = { health: Health, domains: Domains, mailboxes: Mailboxes, aliases: Aliases, dkim: Dkim, queue: Queue, logs: Logs, audit: Audit, admins: () => <Admins me={me} />, account: Account }[page] as React.ComponentType;
  return (
    <div style={{ minHeight: "100%", background: "#faf9f8" }}>
      <header style={{ background: "#0f6cbd", color: "#fff", padding: "8px 16px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <b style={{ fontSize: 18 }}>KMail Admin</b>
        <TabList selectedValue={page} onTabSelect={(_, d) => setPage(String(d.value))} size="small">{PAGES.map(([k, l]) => <Tab key={k} value={k}>{l}</Tab>)}</TabList>
        <span style={{ marginLeft: "auto" }}>{me}</span>
        <Button size="small" onClick={async () => { await post("/logout"); setStage("out"); }}>Sign out</Button>
      </header>
      {recoveryNote && <div style={{ background: "#fff4ce", padding: "8px 16px" }}>{recoveryNote}</div>}
      <main style={{ padding: 16, maxWidth: 1100, margin: "0 auto" }}><Page /></main>
    </div>
  );
}

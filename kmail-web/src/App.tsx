import { useEffect, useState } from "react";
import { Button, Spinner, Tab, TabList, Text } from "@fluentui/react-components";
import { api } from "./api";
import { Login } from "./Login";
import { CalendarView } from "./CalendarView";
import { ContactsView } from "./ContactsView";
import { MailView } from "./MailView";

type View = "mail" | "calendar" | "contacts";

export function App() {
  const [email, setEmail] = useState<string | null | undefined>(undefined); // undefined = still checking
  const [view, setView] = useState<View>("mail");

  useEffect(() => { api.me().then((m) => setEmail(m.email)).catch(() => setEmail(null)); }, []);

  if (email === undefined) return <div style={{ height: "100%", display: "grid", placeItems: "center" }}><Spinner /></div>;
  if (email === null) return <Login onDone={setEmail} />;

  return (
    <div style={{ display: "grid", gridTemplateRows: "48px 1fr", height: "100%", minHeight: 0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 16px", background: "#0f6cbd", color: "#fff" }}>
        <Text weight="semibold" size={500} style={{ color: "#fff" }}>KMail</Text>
        <TabList selectedValue={view} onTabSelect={(_, d) => setView(d.value as View)}>
          {(["mail", "calendar", "contacts"] as View[]).map((v) => <Tab key={v} value={v} style={{ color: "#fff", textTransform: "capitalize" }}>{v}</Tab>)}
        </TabList>
        <div style={{ flex: 1 }} />
        <Text style={{ color: "#fff" }}>{email}</Text>
        <Button appearance="outline" size="small" style={{ color: "#fff", borderColor: "#fff" }} onClick={() => api.logout().finally(() => setEmail(null))}>Sign out</Button>
      </header>
      {view === "mail" && <MailView email={email} onSignedOut={() => setEmail(null)} />}
      {view === "calendar" && <CalendarView me={email} onSignedOut={() => setEmail(null)} />}
      {view === "contacts" && <ContactsView onSignedOut={() => setEmail(null)} />}
    </div>
  );
}

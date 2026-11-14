import { useState } from "react";
import { Button, Tab, TabList, Text } from "@fluentui/react-components";

type View = "mail" | "calendar" | "contacts";

// Phase 1 placeholder: Outlook-style shell (top bar, folder pane, list, reading pane).
export function App() {
  const [view, setView] = useState<View>("mail");
  return (
    <div style={{ display: "grid", gridTemplateRows: "48px 1fr", height: "100%" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 16, padding: "0 16px", background: "#0f6cbd", color: "#fff" }}>
        <Text weight="semibold" size={500} style={{ color: "#fff" }}>KMail</Text>
        <TabList selectedValue={view} onTabSelect={(_, d) => setView(d.value as View)}>
          <Tab value="mail" style={{ color: "#fff" }}>Mail</Tab>
          <Tab value="calendar" style={{ color: "#fff" }}>Calendar</Tab>
          <Tab value="contacts" style={{ color: "#fff" }}>Contacts</Tab>
        </TabList>
      </header>
      {view === "mail" && (
        <main style={{ display: "grid", gridTemplateColumns: "220px 340px 1fr", minHeight: 0 }}>
          <nav style={{ padding: 12, borderRight: "1px solid #e0e0e0" }}>
            <Button appearance="primary">New message</Button>
            <ul style={{ listStyle: "none", padding: 0, marginTop: 16 }}>
              {["Inbox", "Drafts", "Sent", "Junk", "Trash"].map((f) => <li key={f} style={{ padding: "6px 0" }}>{f}</li>)}
            </ul>
          </nav>
          <section style={{ borderRight: "1px solid #e0e0e0", padding: 12 }}>Message list (todo)</section>
          <section style={{ padding: 12 }}>Reading pane (todo)</section>
        </main>
      )}
      {view !== "mail" && <main style={{ padding: 16 }}>{view} (todo, phase 3)</main>}
    </div>
  );
}

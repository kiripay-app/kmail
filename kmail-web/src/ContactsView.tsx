import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Field, Input, MessageBar, MessageBarBody, Spinner, Textarea } from "@fluentui/react-components";
import { ArrowUpload24Regular, PersonAdd24Regular, Search24Regular } from "@fluentui/react-icons";
import { api, ApiError, AuthError, Book, Contact } from "./api";

const lines = (s: string) => s.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const initials = (c: Contact) => (c.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

interface Form { firstName: string; lastName: string; org: string; emails: string; phones: string; notes: string }
const blank: Form = { firstName: "", lastName: "", org: "", emails: "", phones: "", notes: "" };
const fromContact = (c: Contact): Form => ({ firstName: c.firstName, lastName: c.lastName, org: c.org, emails: c.emails.join("\n"), phones: c.phones.join("\n"), notes: c.notes });

export function ContactsView({ onSignedOut }: { onSignedOut: () => void }) {
  const [books, setBooks] = useState<Book[] | null>(null);
  const [list, setList] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Contact | "new" | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const fail = useCallback((e: unknown, msg: string) => (e instanceof AuthError ? onSignedOut() : setError(msg)), [onSignedOut]);
  useEffect(() => { api.books().then(setBooks).catch((e) => { setBooks([]); fail(e, "Could not load your address books."); }); }, [fail]);
  const load = useCallback(() => {
    setLoading(true);
    return api.contacts(active).then((r) => { setList(r.contacts); setError(""); }).catch((e) => fail(e, "Could not load contacts.")).finally(() => setLoading(false));
  }, [active, fail]);
  useEffect(() => { load(); }, [load]);

  const select = (c: Contact | "new") => { setSelected(c); setForm(c === "new" ? blank : fromContact(c)); setError(""); };
  const set = (k: keyof Form) => (_: unknown, d: { value: string }) => setForm((f) => ({ ...f, [k]: d.value }));

  async function save() {
    const emails = lines(form.emails), bad = emails.find((e) => !EMAIL.test(e));
    if (bad) return setError(`"${bad}" is not a valid email address.`);
    if (!form.firstName.trim() && !form.lastName.trim() && !emails.length && !form.org.trim()) return setError("Add a name, an email address or an organisation.");
    const body = { firstName: form.firstName.trim(), lastName: form.lastName.trim(), org: form.org.trim(), notes: form.notes, emails, phones: lines(form.phones) };
    setBusy(true); setError("");
    try {
      if (selected === "new") {
        if (!books?.[0]) return setError("No address book to save into.");
        await api.createContact({ ...body, book: books[0].id });
      } else if (selected) await api.updateContact({ ...body, book: selected.book, href: selected.href, etag: selected.etag });
      setSelected(null); await load();
    } catch (e) { fail(e, e instanceof ApiError && e.status === 409 ? "This contact changed elsewhere. Close it and reopen." : "Could not save the contact."); } finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || selected === "new" || !confirm(`Delete ${selected.name}?`)) return;
    setBusy(true);
    try { await api.deleteContact(selected.book, selected.href, selected.etag); setSelected(null); await load(); } catch (e) { fail(e, "Could not delete the contact."); } finally { setBusy(false); }
  }

  async function importFile(file: File) {
    if (!books?.[0]) return;
    if (file.size > 10 * 1024 * 1024) return setError("That file is over 10 MB.");
    setNote(""); setError("");
    try {
      const r = await api.importVcf(books[0].id, await file.text());
      setNote(`Imported ${r.imported} contact${r.imported === 1 ? "" : "s"}${r.skipped ? `, ${r.skipped} already there` : ""}${r.failed ? `, ${r.failed} failed` : ""}.`);
      await load();
    } catch (e) { fail(e, "Could not import that file. Is it a .vcf contacts export?"); }
  }

  if (!books) return <div style={{ padding: 24 }}><Spinner /></div>;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", height: "100%", minHeight: 0 }}>
      <section style={{ borderRight: "1px solid #e0e0e0", display: "grid", gridTemplateRows: "auto 1fr", minHeight: 0 }}>
        <div style={{ padding: 12, display: "grid", gap: 8, borderBottom: "1px solid #e0e0e0" }}>
          <Button appearance="primary" icon={<PersonAdd24Regular />} disabled={!books.length} onClick={() => select("new")}>New contact</Button>
          <input ref={importInput} type="file" accept=".vcf,text/vcard,text/x-vcard" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
          <Button appearance="subtle" icon={<ArrowUpload24Regular />} disabled={!books.length} onClick={() => importInput.current?.click()}>Import .vcf file</Button>
          {note && <div role="status" style={{ fontSize: 13, color: "#107c10" }}>{note}</div>}
          <form onSubmit={(e) => { e.preventDefault(); setActive(search.trim()); }}>
            <Input style={{ width: "100%" }} contentBefore={<Search24Regular />} placeholder="Search contacts" value={search} onChange={(_, d) => { setSearch(d.value); if (!d.value) setActive(""); }} />
          </form>
        </div>
        <div style={{ overflow: "auto" }}>
          {loading && !list.length && <div style={{ padding: 24 }}><Spinner /></div>}
          {!loading && !list.length && <div style={{ padding: 24, color: "#605e5c" }}>{active ? "No contacts match." : "No contacts yet."}</div>}
          {list.map((c) => (
            <button key={c.id} onClick={() => select(c)} aria-current={selected !== "new" && selected?.id === c.id} style={{ display: "flex", gap: 12, alignItems: "center", width: "100%", textAlign: "left", padding: "10px 16px", border: 0, borderBottom: "1px solid #f0f0f0", cursor: "pointer", font: "inherit", background: selected !== "new" && selected?.id === c.id ? "#e6f0fa" : "transparent" }}>
              <span aria-hidden style={{ width: 36, height: 36, borderRadius: 18, background: "#0f6cbd", color: "#fff", display: "grid", placeItems: "center", fontWeight: 600, flex: "none" }}>{initials(c)}</span>
              <span style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
                <div style={{ color: "#605e5c", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.emails[0] ?? c.org ?? ""}</div>
              </span>
            </button>
          ))}
        </div>
      </section>
      <section aria-label="Contact" style={{ padding: 24, overflow: "auto" }}>
        {!selected ? <div style={{ color: "#605e5c" }}>Select a contact, or create a new one.</div> : (
          <div style={{ display: "grid", gap: 12, maxWidth: 520 }}>
            <h2 style={{ margin: 0 }}>{selected === "new" ? "New contact" : selected.name}</h2>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Field label="First name"><Input value={form.firstName} onChange={set("firstName")} /></Field>
              <Field label="Last name"><Input value={form.lastName} onChange={set("lastName")} /></Field>
            </div>
            <Field label="Organisation"><Input value={form.org} onChange={set("org")} /></Field>
            <Field label="Email addresses" hint="One per line"><Textarea rows={2} value={form.emails} onChange={set("emails")} /></Field>
            <Field label="Phone numbers" hint="One per line"><Textarea rows={2} value={form.phones} onChange={set("phones")} /></Field>
            <Field label="Notes"><Textarea rows={3} value={form.notes} onChange={set("notes")} /></Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Button appearance="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
              <Button onClick={() => setSelected(null)}>Cancel</Button>
              {selected !== "new" && <Button appearance="outline" style={{ marginLeft: "auto", color: "#c50f1f" }} onClick={remove} disabled={busy}>Delete</Button>}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

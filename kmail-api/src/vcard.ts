import ICAL from "ical.js";

export interface ContactInput {
  firstName?: string;
  lastName?: string;
  emails: string[];
  phones: string[];
  org?: string;
  notes?: string;
}
export interface Contact extends Required<Omit<ContactInput, "emails" | "phones">> {
  uid: string;
  name: string;
  emails: string[];
  phones: string[];
}

const displayName = (i: ContactInput) =>
  [i.firstName, i.lastName].filter(Boolean).join(" ") || i.emails[0] || i.org || "(no name)";

function apply(card: ICAL.Component, i: ContactInput) {
  card.updatePropertyWithValue("fn", displayName(i));
  card.updatePropertyWithValue("n", [i.lastName ?? "", i.firstName ?? "", "", "", ""]);
  for (const name of ["email", "tel", "org", "note"]) card.removeAllProperties(name);
  for (const e of i.emails) { const p = new ICAL.Property("email"); p.setParameter("type", "INTERNET"); p.setValue(e); card.addProperty(p); }
  for (const t of i.phones) { const p = new ICAL.Property("tel"); p.setParameter("type", "VOICE"); p.setValue(t); card.addProperty(p); }
  if (i.org) card.addPropertyWithValue("org", [i.org]);
  if (i.notes) card.addPropertyWithValue("note", i.notes);
  card.updatePropertyWithValue("rev", new Date().toISOString().replace(/[-:]|\.\d+/g, ""));
}

export function buildCard(i: ContactInput, uid: string): string {
  const card = new ICAL.Component("vcard");
  card.addPropertyWithValue("version", "3.0");
  card.addPropertyWithValue("uid", uid);
  apply(card, i);
  return card.toString();
}

export function updateCard(data: string, i: ContactInput): string {
  const card = new ICAL.Component(ICAL.parse(data));
  apply(card, i);
  return card.toString();
}

export function parseCard(data: string): Contact | undefined {
  try {
    const card = new ICAL.Component(ICAL.parse(data));
    const n = card.getFirstPropertyValue("n") as string[] | string | null;
    const [last = "", first = ""] = Array.isArray(n) ? n : [];
    const org = card.getFirstPropertyValue("org");
    return {
      uid: String(card.getFirstPropertyValue("uid") ?? ""),
      name: String(card.getFirstPropertyValue("fn") ?? ""),
      firstName: first,
      lastName: last,
      emails: card.getAllProperties("email").map((p) => String(p.getFirstValue())),
      phones: card.getAllProperties("tel").map((p) => String(p.getFirstValue())),
      org: Array.isArray(org) ? org.join(" ") : String(org ?? ""),
      notes: String(card.getFirstPropertyValue("note") ?? ""),
    };
  } catch {
    return undefined;
  }
}

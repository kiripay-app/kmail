import { useCallback, useEffect, useRef, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventDropArg, EventInput as FcEvent } from "@fullcalendar/core";
import type { EventResizeDoneArg } from "@fullcalendar/interaction";
import { Button, Checkbox, MessageBar, MessageBarBody, Spinner } from "@fluentui/react-components";
import { CalendarAdd24Regular, ArrowUpload24Regular } from "@fluentui/react-icons";
import { api, ApiError, AuthError, Cal, CalEvent } from "./api";
import { Draft, EventDialog } from "./EventDialog";

const PALETTE = ["#0f6cbd", "#107c10", "#8764b8", "#c239b3", "#ca5010", "#038387", "#986f0b"];
const colorOf = (cals: Cal[], id: string) => cals.find((c) => c.id === id)?.color || PALETTE[Math.max(0, cals.findIndex((c) => c.id === id)) % PALETTE.length];

export function CalendarView({ me, onSignedOut }: { me: string; onSignedOut: () => void }) {
  const [cals, setCals] = useState<Cal[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const fc = useRef<FullCalendar>(null);
  const calsRef = useRef<Cal[]>([]);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;

  const fail = useCallback((e: unknown, msg: string) => (e instanceof AuthError ? onSignedOut() : setError(msg)), [onSignedOut]);
  useEffect(() => { api.calendars().then((c) => { calsRef.current = c; setCals(c); }).catch((e) => { setCals([]); fail(e, "Could not load your calendars."); }); }, [fail]);
  const refetch = () => fc.current?.getApi().refetchEvents();
  useEffect(() => { refetch(); }, [hidden]);

  const load = useCallback((info: { start: Date; end: Date }, ok: (e: FcEvent[]) => void, bad: (e: Error) => void) => {
    const visible = calsRef.current.filter((c) => !hiddenRef.current.has(c.id)).map((c) => c.id);
    if (!visible.length) return ok([]);
    api.events(info.start.toISOString(), info.end.toISOString(), visible).then(({ events, failed }) => {
      setError(failed.length ? "Some calendars could not be loaded." : "");
      ok(events.map((e) => ({
        id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay,
        backgroundColor: colorOf(calsRef.current, e.calendar), borderColor: colorOf(calsRef.current, e.calendar),
        editable: !e.recurring, extendedProps: { ev: e },
      })));
    }).catch((e) => { fail(e, "Could not load events."); bad(e); });
  }, [fail]);

  async function moved(arg: EventDropArg | EventResizeDoneArg) {
    const e = arg.event.extendedProps.ev as CalEvent;
    const start = arg.event.start!, end = arg.event.end ?? new Date(+start + (e.allDay ? 86_400_000 : 3600_000));
    const d = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    try {
      await api.updateEvent({ calendar: e.calendar, href: e.href, etag: e.etag, title: e.title, allDay: e.allDay, location: e.location, description: e.description,
        start: e.allDay ? d(start) : start.toISOString(), end: e.allDay ? d(end) : end.toISOString() });
      refetch();
    } catch (err) { arg.revert(); fail(err, "Could not move the event."); }
  }

  async function importFile(file: File) {
    const target = cals?.find((c) => !hidden.has(c.id)) ?? cals?.[0];
    if (!target) return;
    if (file.size > 10 * 1024 * 1024) return setError("That file is over 10 MB.");
    setNote(""); setError("");
    try {
      const r = await api.importIcs(target.id, await file.text());
      setNote(`Imported ${r.imported} event${r.imported === 1 ? "" : "s"} into ${target.name}${r.skipped ? `, ${r.skipped} already there` : ""}${r.failed ? `, ${r.failed} failed` : ""}.`);
      refetch();
    } catch (e) { fail(e, e instanceof ApiError && e.code === "invalid_ics" ? "That does not look like a calendar (.ics) file." : "Could not import the file."); }
  }

  if (!cals) return <div style={{ padding: 24 }}><Spinner /></div>;
  const open = (start: Date, end: Date, allDay: boolean) => setDraft({ start, end, allDay });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "230px 1fr", height: "100%", minHeight: 0 }}>
      <aside style={{ borderRight: "1px solid #e0e0e0", padding: 12, display: "grid", gap: 12, alignContent: "start" }}>
        <Button appearance="primary" icon={<CalendarAdd24Regular />} disabled={!cals.length} onClick={() => { const s = new Date(); s.setMinutes(0, 0, 0); s.setHours(s.getHours() + 1); open(s, new Date(+s + 3600_000), false); }}>New event</Button>
        <div>
          <div style={{ fontWeight: 600, margin: "4px 0" }}>My calendars</div>
          {cals.length === 0 && <div style={{ color: "#605e5c", fontSize: 13 }}>No calendars found.</div>}
          {cals.map((c) => (
            <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Checkbox checked={!hidden.has(c.id)} onChange={(_, d) => setHidden((h) => { const n = new Set(h); d.checked ? n.delete(c.id) : n.add(c.id); return n; })} label={c.name} />
              <span aria-hidden style={{ width: 10, height: 10, borderRadius: 5, background: colorOf(cals, c.id) }} />
            </div>
          ))}
        </div>
        <div>
          <input ref={importInput} type="file" accept=".ics,text/calendar" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importFile(f); }} />
          <Button appearance="subtle" icon={<ArrowUpload24Regular />} disabled={!cals.length} onClick={() => importInput.current?.click()}>Import .ics file</Button>
          {note && <div role="status" style={{ fontSize: 13, color: "#107c10", marginTop: 6 }}>{note}</div>}
        </div>
      </aside>
      <section style={{ padding: "8px 12px", minHeight: 0, display: "grid", gridTemplateRows: "auto 1fr" }}>
        {error ? <MessageBar intent="warning"><MessageBarBody>{error}</MessageBarBody></MessageBar> : <div />}
        <FullCalendar
          ref={fc} height="100%" plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]} initialView="timeGridWeek" nowIndicator selectable selectMirror
          firstDay={1} dayMaxEvents scrollTime="07:00:00" slotDuration="00:30:00"
          headerToolbar={{ left: "prev,next today", center: "title", right: "timeGridDay,timeGridWeek,dayGridMonth" }}
          buttonText={{ today: "Today", day: "Day", week: "Week", month: "Month" }}
          events={load}
          select={(i) => { open(i.start, i.end, i.allDay); fc.current?.getApi().unselect(); }}
          eventClick={(i) => { const e = i.event.extendedProps.ev as CalEvent; setDraft({ event: e, start: new Date(e.start), end: new Date(e.end), allDay: e.allDay }); }}
          eventDrop={moved} eventResize={moved}
        />
      </section>
      {draft && <EventDialog draft={draft} me={me} calendars={cals} defaultCalendar={cals[0]?.id ?? ""} onClose={() => setDraft(null)} onChanged={() => { setDraft(null); refetch(); }} />}
    </div>
  );
}

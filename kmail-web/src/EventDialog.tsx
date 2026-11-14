import { useState } from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, Field, Input, MessageBar, MessageBarBody, Select, Switch, Textarea } from "@fluentui/react-components";
import { ApiError, api, Cal, CalEvent, EventInput, Recurrence } from "./api";

export interface Draft { event?: CalEvent; start: Date; end: Date; allDay: boolean }

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date, dateOnly: boolean) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${dateOnly ? "" : `T${pad(d.getHours())}:${pad(d.getMinutes())}`}`;
// An all-day event's end is exclusive; people think of the last day itself, so show/accept that.
const dayBefore = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1);
const dayAfter = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
const parseLocal = (v: string, dateOnly: boolean) => (dateOnly ? new Date(`${v}T00:00:00`) : new Date(v));

export function EventDialog({ draft, calendars, defaultCalendar, onClose, onChanged }: { draft: Draft; calendars: Cal[]; defaultCalendar: string; onClose: () => void; onChanged: () => void }) {
  const ev = draft.event;
  const [title, setTitle] = useState(ev?.title ?? "");
  const [calendar, setCalendar] = useState(ev?.calendar ?? defaultCalendar);
  const [allDay, setAllDay] = useState(draft.allDay);
  const [start, setStart] = useState(toLocalInput(draft.start, draft.allDay));
  const [end, setEnd] = useState(toLocalInput(draft.allDay ? dayBefore(draft.end) : draft.end, draft.allDay));
  const [location, setLocation] = useState(ev?.location ?? "");
  const [description, setDescription] = useState(ev?.description ?? "");
  const [repeat, setRepeat] = useState<string>(ev?.recurring ? "keep" : "none");
  const [count, setCount] = useState("");
  const [reminder, setReminder] = useState<string>(ev ? "keep" : "15");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const flip = (on: boolean) => {
    // Convert the current values when toggling all-day so the entered times are not lost.
    const s = parseLocal(start, allDay), e = parseLocal(end, allDay);
    setStart(toLocalInput(s, on));
    setEnd(toLocalInput(on ? e : e <= s ? new Date(+s + 3600_000) : e, on));
    setAllDay(on);
  };

  async function save() {
    if (!title.trim()) return setError("Add a title.");
    const s = parseLocal(start, allDay), e0 = parseLocal(end, allDay);
    if (isNaN(+s) || isNaN(+e0)) return setError("Check the start and end.");
    const e = allDay ? dayAfter(e0) : e0;
    if (allDay ? e <= s : e < s) return setError("The end must be after the start.");
    const recurrence: Recurrence | null | undefined =
      repeat === "keep" ? undefined : repeat === "none" ? null : { freq: repeat as Recurrence["freq"], ...(count ? { count: Math.min(999, Math.max(1, Number(count))) } : {}) };
    const input: EventInput = {
      calendar, title: title.trim(), allDay, location: location.trim(), description,
      start: allDay ? start : s.toISOString(), end: allDay ? toLocalInput(e, true) : e.toISOString(),
      recurrence, reminderMinutes: reminder === "keep" ? undefined : reminder === "none" ? null : Number(reminder),
    };
    setBusy(true); setError("");
    try {
      if (ev) await api.updateEvent({ ...input, calendar: ev.calendar, href: ev.href, etag: ev.etag });
      else await api.createEvent(input);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError && err.status === 409 ? "Someone changed this event while you had it open. Close and reopen it." : "Could not save the event.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!ev) return;
    if (ev.recurring && !confirm("This deletes every occurrence of the repeating event. Continue?")) return;
    setBusy(true);
    try { await api.deleteEvent(ev.calendar, ev.href, ev.etag); onChanged(); } catch { setError("Could not delete the event."); setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(_, d) => !d.open && onClose()}>
      <DialogSurface style={{ maxWidth: 520 }}>
        <DialogBody>
          <DialogTitle>{ev ? "Edit event" : "New event"}</DialogTitle>
          <DialogContent style={{ display: "grid", gap: 10, paddingTop: 8 }}>
            {error && <MessageBar intent="error"><MessageBarBody>{error}</MessageBarBody></MessageBar>}
            <Field label="Title"><Input value={title} onChange={(_, d) => setTitle(d.value)} autoFocus /></Field>
            <Field label="Calendar">
              <Select value={calendar} disabled={Boolean(ev)} onChange={(_, d) => setCalendar(d.value)}>
                {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Switch label="All day" checked={allDay} onChange={(_, d) => flip(d.checked)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Starts"><Input type={allDay ? "date" : "datetime-local"} value={start} onChange={(_, d) => setStart(d.value)} /></Field>
              <Field label="Ends"><Input type={allDay ? "date" : "datetime-local"} value={end} onChange={(_, d) => setEnd(d.value)} /></Field>
            </div>
            <Field label="Location"><Input value={location} onChange={(_, d) => setLocation(d.value)} /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Field label="Repeat" hint={ev?.recurring ? "Changes apply to the whole series." : undefined}>
                <Select value={repeat} onChange={(_, d) => setRepeat(d.value)}>
                  {ev?.recurring && <option value="keep">Keep current repeat</option>}
                  <option value="none">Does not repeat</option>
                  <option value="DAILY">Daily</option><option value="WEEKLY">Weekly</option><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option>
                </Select>
              </Field>
              <Field label="Reminder">
                <Select value={reminder} onChange={(_, d) => setReminder(d.value)}>
                  {ev && <option value="keep">Keep current</option>}
                  <option value="none">None</option><option value="0">At start</option><option value="15">15 minutes before</option><option value="60">1 hour before</option><option value="1440">1 day before</option>
                </Select>
              </Field>
            </div>
            {repeat !== "none" && repeat !== "keep" && (
              <Field label="Number of occurrences" hint="Leave empty to repeat with no end.">
                <Input type="number" min={1} max={999} value={count} onChange={(_, d) => setCount(d.value)} />
              </Field>
            )}
            <Field label="Notes"><Textarea rows={3} value={description} onChange={(_, d) => setDescription(d.value)} /></Field>
            {ev && ev.attendees.length > 0 && <div style={{ fontSize: 13, color: "#605e5c" }}>Attendees: {ev.attendees.map((a) => a.name || a.email).join(", ")}</div>}
          </DialogContent>
          <DialogActions>
            {ev && <Button appearance="outline" onClick={remove} disabled={busy} style={{ marginRight: "auto", color: "#c50f1f" }}>Delete</Button>}
            <Button onClick={onClose}>Cancel</Button>
            <Button appearance="primary" onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle, MessageBar, MessageBarBody, Spinner, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@fluentui/react-components";
import { useCallback, useEffect, useState } from "react";

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T>(), [err, setErr] = useState(""), [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const reload = useCallback(async () => { setLoading(true); try { setData(await fn()); setErr(""); } catch (e: any) { setErr(e.message); } finally { setLoading(false); } }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, err, loading, reload, setErr };
}

export const Notice = ({ err, ok }: { err?: string; ok?: string }) =>
  err ? <MessageBar intent="error"><MessageBarBody>{err}</MessageBarBody></MessageBar> : ok ? <MessageBar intent="success"><MessageBarBody>{ok}</MessageBarBody></MessageBar> : null;

export function Grid({ cols, rows, empty = "Nothing here yet." }: { cols: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p style={{ color: "#605e5c" }}>{empty}</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <Table size="small" aria-label="data">
        <TableHeader><TableRow>{cols.map((c) => <TableHeaderCell key={c}>{c}</TableHeaderCell>)}</TableRow></TableHeader>
        <TableBody>{rows.map((r, i) => <TableRow key={i}>{r.map((c, j) => <TableCell key={j}>{c}</TableCell>)}</TableRow>)}</TableBody>
      </Table>
    </div>
  );
}

/** Asks "are you sure?" before running a destructive action. */
export function Confirm({ label, title, text, onYes, danger = true, appearance = "outline" }: { label: string; title: string; text: string; onYes: () => Promise<unknown>; danger?: boolean; appearance?: "outline" | "subtle" | "primary" }) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
      <Button size="small" appearance={appearance} onClick={() => setOpen(true)}>{label}</Button>
      <DialogSurface><DialogBody>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>{text}</DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button appearance="primary" style={danger ? { background: "#c50f1f" } : undefined} disabled={busy} onClick={async () => { setBusy(true); try { await onYes(); } finally { setBusy(false); setOpen(false); } }}>{busy ? <Spinner size="tiny" /> : label}</Button>
        </DialogActions>
      </DialogBody></DialogSurface>
    </Dialog>
  );
}

export const fmtDate = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "never");
export const fmtUsed = (m: number) => (m >= 1024 ? `${(m / 1024).toFixed(1)} GB` : `${m} MB`);
export const fmtMiB = (m: number) => (m === 0 ? "unlimited" : m >= 1024 ? `${(m / 1024).toFixed(m % 1024 ? 1 : 0)} GB` : `${m} MB`);

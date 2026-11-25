"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, ChevronDown, Download, RefreshCw, ShieldAlert, Trash2, X } from "lucide-react";
import { Collapse, MotionPresence } from "@/components/shared/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Backup = {
  backup_id: string;
  backup_kind: "monthly_retention" | "manual_before_date" | "manual_all";
  backup_status: string;
  fixed_cutoff_at: string;
  file_count: number;
  row_count: number;
  deleted_count: number;
  delete_expires_at: string | null;
  created_at: string;
  completed_at: string | null;
  attempt_count: number;
  next_attempt_at: string;
  email_attempt_count: number;
  last_error_code: string | null;
};

type BackupFile = {
  file_id: string;
  part_number: number;
  object_path: string;
  row_count: number;
  raw_byte_count: number;
  sha256_hex: string;
  downloaded_by_caller: boolean;
};

type StatusView = {
  label: string;
  variant: "brand" | "neutral" | "success" | "destructive" | "warning";
  explanation?: string;
};

const dateTime = new Intl.DateTimeFormat("en-PH", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Manila",
});
const PROCESSING = new Set(["pending", "snapshotting", "deletion_requested", "deleting", "email_pending"]);
const RETRY_CODES = new Set(["snapshot_retry_pending", "deletion_retry_pending"]);

function formatDate(value: string | number) { return dateTime.format(new Date(value)); }
function rows(count: number) { return `${count.toLocaleString()} ${count === 1 ? "row" : "rows"}`; }
function kindLabel(kind: Backup["backup_kind"]) {
  if (kind === "monthly_retention") return "Monthly backup";
  if (kind === "manual_all") return "All-entries backup";
  return "Before-date backup";
}
function hasOpenWindow(backup: Backup, now: number) {
  return backup.backup_status === "ready"
    && backup.delete_expires_at !== null
    && Date.parse(backup.delete_expires_at) > now;
}
function isPinned(backup: Backup, now: number) {
  return PROCESSING.has(backup.backup_status) || hasOpenWindow(backup, now);
}
function allDownloaded(files: BackupFile[]) {
  return files.length > 0 && files.every((file) => file.downloaded_by_caller);
}

function statusView(backup: Backup, now: number): StatusView {
  const code = backup.last_error_code;
  if (code === "deletion_window_expired" || (backup.backup_status === "ready" && !hasOpenWindow(backup, now))) {
    return { label: "Expired", variant: "neutral", explanation: "The deletion window ended before deletion was confirmed. Prepare a new backup to continue." };
  }
  if (backup.backup_status === "completed" && backup.row_count === 0) {
    return { label: "Nothing to delete", variant: "neutral", explanation: "No matching Activity Log entries were found. Nothing was deleted." };
  }
  if (RETRY_CODES.has(code ?? "")) {
    return {
      label: "Retrying",
      variant: "warning",
      explanation: code === "deletion_retry_pending"
        ? "Deletion is not finished yet. The system will retry the same backed-up entries automatically."
        : "Backup files could not be prepared yet. The system will try again automatically.",
    };
  }
  if (code === "email_delivery_failed" && backup.backup_status === "email_pending") {
    return { label: "Retrying", variant: "warning", explanation: "The backup email could not be sent yet. The system will try again automatically." };
  }
  if (backup.backup_status === "email_failed") {
    return { label: "Needs attention", variant: "destructive", explanation: "The backup email could not be sent. Use Retry email to try again." };
  }
  if (code === "snapshot_attempts_exhausted") {
    return { label: "Needs attention", variant: "destructive", explanation: "The backup could not be prepared after several attempts. Prepare a new backup to try again." };
  }
  if (code === "snapshot_expired") {
    return { label: "Needs attention", variant: "destructive", explanation: "The backup took too long to prepare. Prepare a new backup to try again." };
  }
  if (backup.backup_status === "failed") {
    return { label: "Needs attention", variant: "destructive", explanation: "This backup could not be completed. Prepare a new backup to try again." };
  }
  return ({
    pending: { label: "Waiting", variant: "brand" },
    snapshotting: { label: "Preparing backup", variant: "brand" },
    ready: { label: "Ready to delete", variant: "warning" },
    deletion_requested: { label: "Deleting", variant: "warning" },
    deleting: { label: "Deleting", variant: "warning" },
    email_pending: { label: "Sending backup email", variant: "brand" },
    completed: { label: "Complete", variant: "success" },
  } as Record<string, StatusView>)[backup.backup_status] ?? {
    label: "Needs attention",
    variant: "destructive",
    explanation: "This backup could not be completed. Prepare a new backup to try again.",
  };
}

function countdown(backup: Backup, now: number) {
  if (!backup.delete_expires_at) return null;
  const remaining = Date.parse(backup.delete_expires_at) - now;
  if (remaining <= 0) return null;
  if (remaining < 60_000) return "Delete window ends in less than a minute";
  return `Delete window ends in ${Math.ceil(remaining / 60_000)} min`;
}

function StatusChip({ view }: { view: StatusView }) {
  return <Badge variant={view.variant}>{view.label}</Badge>;
}

function ErrorDetails({ backup, view }: { backup: Backup; view: StatusView }) {
  if (!view.explanation && !backup.last_error_code) return null;
  return <div className="grid gap-1">
    {view.explanation ? <p className="text-sm text-muted-foreground">{view.explanation}</p> : null}
    {backup.last_error_code ? <p className="text-xs text-muted-foreground">Error code: {backup.last_error_code}</p> : null}
  </div>;
}

function BackupFiles({ backup, files, busy, onDownload }: {
  backup: Backup; files: BackupFile[]; busy: boolean;
  onDownload: (backup: Backup, file: BackupFile) => void;
}) {
  if (!files.length) return null;
  return <div className="grid gap-2" aria-label="Backup files">
    {files.map((file) => <div key={file.file_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-2">
      <p className="text-sm text-muted-foreground">Part {file.part_number} · {rows(file.row_count)}</p>
      <Button type="button" size="sm" variant="outline" disabled={busy}
        aria-label={`Download part ${file.part_number}`} onClick={() => onDownload(backup, file)}>
        <Download aria-hidden /> {file.downloaded_by_caller ? "Downloaded" : `Download part ${file.part_number}`}
      </Button>
    </div>)}
  </div>;
}

function PreparationActions({ beforeDate, busy, onDate, onPrepare }: {
  beforeDate: string; busy: boolean; onDate: (value: string) => void;
  onPrepare: (mode: "before_date" | "all") => void;
}) {
  return <div className="grid gap-3 lg:grid-cols-2">
    <section className="grid content-start gap-3 rounded-xl border bg-muted/30 p-3.5">
      <div className="grid gap-1">
        <h3 className="font-medium">Delete entries before a date</h3>
        <p className="text-sm text-muted-foreground">Prepare a backup first. Nothing is deleted until every backup file is downloaded and you confirm the deletion.</p>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor="activity-log-delete-before" className="text-sm font-medium">Date</label>
        <Input id="activity-log-delete-before" type="date" value={beforeDate} disabled={busy}
          aria-describedby={!beforeDate ? "activity-log-delete-before-prompt" : undefined}
          onChange={(event) => onDate(event.target.value)} />
        {!beforeDate ? <p id="activity-log-delete-before-prompt" className="text-sm text-muted-foreground">Select a date</p> : null}
      </div>
      <Button type="button" variant="outline" className="w-full sm:w-fit" disabled={busy || !beforeDate}
        onClick={() => onPrepare("before_date")}>Prepare backup for this date</Button>
    </section>
    <section className="grid content-start gap-3 rounded-xl border bg-muted/30 p-3.5">
      <div className="grid gap-1">
        <h3 className="font-medium">Delete all Activity Log entries</h3>
        <p className="text-sm text-muted-foreground">Prepare a full backup first. Nothing is deleted until every backup file is downloaded and you confirm the deletion.</p>
      </div>
      <Button type="button" variant="outline" className="w-full sm:w-fit" disabled={busy}
        onClick={() => onPrepare("all")}><ShieldAlert aria-hidden /> Prepare backup for all entries</Button>
    </section>
  </div>;
}

function CurrentCard({ backup, files, busy, confirmation, now, selected, onDownload, onConfirm, onSelect, onCancel, onDelete }: {
  backup: Backup; files: BackupFile[]; busy: boolean; confirmation: string; now: number; selected: boolean;
  onDownload: (backup: Backup, file: BackupFile) => void; onConfirm: (value: string) => void;
  onSelect: () => void; onCancel: () => void; onDelete: (backup: Backup) => void;
}) {
  const view = statusView(backup, now);
  const downloaded = allDownloaded(files);
  const unexpired = hasOpenWindow(backup, now);
  const expected = `DELETE ${backup.row_count} LOG ENTRIES`;
  const windowLabel = unexpired ? countdown(backup, now) : null;
  return <section className="grid gap-3 rounded-xl border p-3.5" aria-labelledby="current-activity-log-backup">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="grid gap-1">
        <h3 id="current-activity-log-backup" className="font-display font-semibold">Current backup</h3>
        <p className="text-sm text-muted-foreground">{formatDate(backup.created_at)} · {kindLabel(backup.backup_kind)} · {rows(backup.row_count)}</p>
      </div>
      <StatusChip view={view} />
    </div>
    {windowLabel ? <p className="text-sm font-medium">{windowLabel}</p> : null}
    <ErrorDetails backup={backup} view={view} />
    <BackupFiles backup={backup} files={files} busy={busy} onDownload={onDownload} />
    {backup.backup_status === "ready" && selected ? <div className="grid gap-2 rounded-xl bg-muted/40 p-3">
      <label htmlFor={`delete-confirm-${backup.backup_id}`} className="text-sm font-medium">Type {expected}</label>
      <Input id={`delete-confirm-${backup.backup_id}`} value={confirmation} disabled={busy || !unexpired}
        onChange={(event) => onConfirm(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="destructive"
          disabled={busy || !downloaded || !unexpired || confirmation !== expected}
          onClick={() => onDelete(backup)}><Trash2 aria-hidden /> Delete backed-up rows</Button>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
      {!downloaded ? <p className="text-xs text-muted-foreground">Download every file to enable deletion.</p> : null}
    </div> : backup.backup_status === "ready" ? <Button type="button" variant="destructive" className="w-full sm:w-fit"
      disabled={!downloaded || !unexpired} onClick={onSelect}><Trash2 aria-hidden /> Continue to delete</Button> : null}
  </section>;
}

function HistoryRow({ backup, files, busy, now, expanded, onToggle, onDownload, onRetry }: {
  backup: Backup; files: BackupFile[]; busy: boolean; now: number; expanded: boolean; onToggle: () => void;
  onDownload: (backup: Backup, file: BackupFile) => void; onRetry: (id: string) => void;
}) {
  const view = statusView(backup, now);
  const detailsId = `backup-history-details-${backup.backup_id}`;
  return <article className={cn("overflow-hidden rounded-xl border", view.label === "Nothing to delete" && "bg-muted/30")}>
    <button type="button" className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-muted motion-reduce:transition-none"
      aria-expanded={expanded} aria-controls={detailsId}
      aria-label={`${expanded ? "Collapse" : "Expand"} ${kindLabel(backup.backup_kind)} from ${formatDate(backup.created_at)}`}
      onClick={onToggle}>
      <span className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-3">
        <span className="text-sm font-medium">{formatDate(backup.created_at)}</span>
        <span className="text-xs text-muted-foreground">{kindLabel(backup.backup_kind)}</span>
        <span className="text-xs text-muted-foreground">{rows(backup.row_count)}</span>
      </span>
      <span className="flex items-center gap-2"><StatusChip view={view} />
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform motion-reduce:transition-none", expanded && "rotate-180")} aria-hidden />
      </span>
    </button>
    <Collapse open={expanded}><div id={detailsId} className="grid gap-3 border-t bg-muted/20 p-3.5">
      <ErrorDetails backup={backup} view={view} />
      <BackupFiles backup={backup} files={files} busy={busy} onDownload={onDownload} />
      {backup.backup_status === "email_failed" ? <Button type="button" variant="outline" className="w-full sm:w-fit"
        disabled={busy} onClick={() => onRetry(backup.backup_id)}><ArchiveRestore aria-hidden /> Retry email</Button> : null}
    </div></Collapse>
  </article>;
}

function History({ backups, files, busy, now, open, expandedId, onToggle, onToggleRow, onDownload, onRetry }: {
  backups: Backup[]; files: Record<string, BackupFile[]>; busy: boolean; now: number; open: boolean; expandedId: string | null;
  onToggle: () => void; onToggleRow: (id: string) => void;
  onDownload: (backup: Backup, file: BackupFile) => void; onRetry: (id: string) => void;
}) {
  return <section className="overflow-hidden rounded-xl border" aria-labelledby="backup-history-heading">
    <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 p-3.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-muted motion-reduce:transition-none"
      aria-expanded={open} aria-controls="activity-log-backup-history" onClick={onToggle}>
      <span id="backup-history-heading" className="font-display font-semibold">Backup history ({backups.length})</span>
      <ChevronDown className={cn("size-4 text-muted-foreground transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
    </button>
    <Collapse open={open}><div id="activity-log-backup-history" className="grid gap-2 border-t p-3">
      {!backups.length ? <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">No backup history yet.</p>
        : backups.map((backup) => <HistoryRow key={backup.backup_id} backup={backup} files={files[backup.backup_id] ?? []}
          busy={busy} now={now} expanded={expandedId === backup.backup_id}
          onToggle={() => onToggleRow(backup.backup_id)} onDownload={onDownload} onRetry={onRetry} />)}
    </div></Collapse>
  </section>;
}

function PanelHeader({ backup, loadState, hasEmailFailure, now, open, onToggle }: {
  backup: Backup | null; loadState: "loading" | "error" | "ready"; hasEmailFailure: boolean; now: number; open: boolean; onToggle: () => void;
}) {
  const view = backup ? statusView(backup, now) : null;
  const current = backup ? isPinned(backup, now) : false;
  return <div className="flex items-start gap-3 p-3.5 sm:p-4">
    <div className="min-w-0 flex-1">
      <h2 id="activity-log-backups" className="font-display font-semibold">Backups and clearing</h2>
      {backup && view ? <p className="text-sm text-muted-foreground">{current ? "Current backup" : "Last backup"}: {formatDate(backup.created_at)} · {rows(backup.row_count)} · {view.label}</p>
        : loadState === "loading" ? <p className="text-sm text-muted-foreground">Loading backups…</p>
        : loadState === "error" ? <p role="alert" className="text-sm text-destructive">Backups could not be loaded. Open this panel to retry.</p>
        : <p className="text-sm text-muted-foreground">No backups yet.</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {backup && PROCESSING.has(backup.backup_status) ? <Badge variant="brand">Backup in progress</Badge> : null}
        {backup && hasOpenWindow(backup, now) ? <Badge variant="warning">Ready to delete</Badge> : null}
        {hasEmailFailure ? <Badge variant="destructive">Email not sent</Badge> : null}
      </div>
    </div>
    <Button type="button" variant="outline" aria-label={`${open ? "Hide" : "Show"} backups and clearing`}
      aria-expanded={open} aria-controls="activity-log-backup-controls" onClick={onToggle}>
      {open ? "Hide" : "Show"}<ChevronDown className={cn("transition-transform motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
    </Button>
  </div>;
}

export function ActivityLogBackupPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [files, setFiles] = useState<Record<string, BackupFile[]>>({});
  const [beforeDate, setBeforeDate] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const result = await supabase.rpc("list_activity_log_backups", { p_limit: 20 });
    if (result.error || !Array.isArray(result.data)) throw result.error ?? new Error("invalid backups");
    const next = result.data as Backup[];
    const fileResults = await Promise.all(next.map(async (backup) => {
      const listed = await supabase.rpc("list_activity_log_backup_files", { p_backup_id: backup.backup_id });
      if (listed.error || !Array.isArray(listed.data)) throw listed.error ?? new Error("invalid backup files");
      return [backup.backup_id, listed.data as BackupFile[]] as const;
    }));
    if (generation !== loadGeneration.current) return false;
    setBackups(next);
    setFiles(Object.fromEntries(fileResults));
    setLastUpdated(Date.now());
    setLoadFailed(false);
    return true;
  }, [supabase]);

  useEffect(() => { void load().catch(() => { setLoadFailed(true); setError("Backup information could not be loaded. Refresh to try again."); }); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const current = backups.find((backup) => isPinned(backup, currentTime)) ?? null;
  const history = current ? backups.filter((backup) => backup.backup_id !== current.backup_id) : backups;
  const summary = current ?? backups[0] ?? null;

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try { if (await load()) { setCurrentTime(Date.now()); setError(null); } }
    catch { setError("Backup information could not be refreshed. Try again."); }
    finally { setBusy(false); }
  }
  // The action already succeeded when this runs, so a failed re-read must not report the action as failed.
  async function refreshAfterAction() {
    try { await load(); }
    catch { setLoadFailed(true); setError("Backup information could not be refreshed. Try again."); }
  }
  async function createBackup(mode: "before_date" | "all") {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await supabase.rpc("create_activity_log_manual_backup", { p_mode: mode, p_before_date: mode === "before_date" ? beforeDate : null });
      if (result.error) throw result.error;
      setMessage("Backup queued. Refresh while the files are being prepared."); await refreshAfterAction();
    } catch (caught) {
      const code = caught && typeof caught === "object" && "code" in caught ? String(caught.code) : "";
      setError(code === "CAL06" ? "Another Activity Log backup is still in progress. Finish it before starting a new one." : "The backup could not be started. Try again.");
    } finally { setBusy(false); }
  }
  async function downloadFile(backup: Backup, file: BackupFile) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/activity-log/backups/${backup.backup_id}/files/${file.file_id}/download`, { method: "GET", cache: "no-store" });
      if (!response.ok) throw new Error("download failed");
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a"); link.href = url;
      link.download = file.object_path.split("/").at(-1) ?? `activity-log-part-${file.part_number}.csv`;
      link.click(); URL.revokeObjectURL(url); setMessage(`Downloaded file ${file.part_number}.`); await refreshAfterAction();
    } catch { setError("The backup file could not be downloaded. Try again."); }
    finally { setBusy(false); }
  }
  async function requestDeletion(backup: Backup) {
    const expected = `DELETE ${backup.row_count} LOG ENTRIES`;
    if (!hasOpenWindow(backup, Date.now()) || !allDownloaded(files[backup.backup_id] ?? []) || confirmation !== expected) {
      if (!hasOpenWindow(backup, Date.now())) {
        setSelectedId(null); setConfirmation("");
        setMessage("The deletion window expired. Prepare a new backup to continue.");
      }
      return;
    }
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await supabase.rpc("request_activity_log_backup_deletion", { p_backup_id: backup.backup_id, p_confirmation: confirmation });
      if (result.error || result.data !== true) throw result.error ?? new Error("delete failed");
      setConfirmation(""); setSelectedId(null);
      setMessage("Deletion queued. Only rows in the downloaded backup can be removed."); await refreshAfterAction();
    } catch { setError("Deletion was not queued. Check the downloads, expiry, and typed confirmation."); }
    finally { setBusy(false); }
  }
  async function retryEmail(backupId: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await supabase.rpc("retry_activity_log_backup_email", { p_backup_id: backupId });
      if (result.error || result.data !== true) throw result.error ?? new Error("retry failed");
      setMessage("Backup email queued for retry."); await refreshAfterAction();
    } catch { setError("The backup email could not be queued for retry."); }
    finally { setBusy(false); }
  }

  return <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="activity-log-backups">
    <PanelHeader backup={summary} loadState={lastUpdated !== null ? "ready" : loadFailed ? "error" : "loading"} hasEmailFailure={backups.some((backup) => backup.backup_status === "email_failed")}
      now={currentTime} open={panelOpen} onToggle={() => setPanelOpen((open) => !open)} />
    <Collapse open={panelOpen}><div id="activity-log-backup-controls" className="grid gap-4 border-t p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{lastUpdated ? `Last updated ${formatDate(lastUpdated)}` : "Not updated yet"}</p>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}><RefreshCw aria-hidden /> {busy ? "Refreshing…" : "Refresh"}</Button>
      </div>
      <MotionPresence open={Boolean(error)}>{error ? <InlineAlert className="flex items-start justify-between gap-3">
        <span>{error}</span><Button type="button" size="icon-sm" variant="ghost" className="-my-2 -mr-2 shrink-0"
          aria-label="Dismiss error" onClick={() => setError(null)}><X aria-hidden /></Button>
      </InlineAlert> : null}</MotionPresence>
      <MotionPresence open={Boolean(message)}>{message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}</MotionPresence>
      <PreparationActions beforeDate={beforeDate} busy={busy} onDate={setBeforeDate} onPrepare={(mode) => void createBackup(mode)} />
      {current ? <CurrentCard backup={current} files={files[current.backup_id] ?? []} busy={busy} confirmation={confirmation}
        now={currentTime} selected={selectedId === current.backup_id} onDownload={(backup, file) => void downloadFile(backup, file)}
        onConfirm={setConfirmation} onSelect={() => { setSelectedId(current.backup_id); setConfirmation(""); }}
        onCancel={() => { setSelectedId(null); setConfirmation(""); }} onDelete={(backup) => void requestDeletion(backup)} /> : null}
      <History backups={history} files={files} busy={busy} now={currentTime} open={historyOpen} expandedId={expandedHistoryId}
        onToggle={() => setHistoryOpen((open) => !open)} onToggleRow={(id) => setExpandedHistoryId((value) => value === id ? null : id)}
        onDownload={(backup, file) => void downloadFile(backup, file)} onRetry={(id) => void retryEmail(id)} />
    </div></Collapse>
  </section>;
}

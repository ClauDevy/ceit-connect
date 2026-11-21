"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveRestore, Download, RefreshCw, ShieldAlert, Trash2 } from "lucide-react";
import { MotionPresence } from "@/components/shared/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import { createClient } from "@/lib/supabase/client";

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

function statusLabel(status: string) {
  return ({
    pending: "Waiting",
    snapshotting: "Preparing files",
    ready: "Ready to delete",
    deletion_requested: "Deletion queued",
    deleting: "Deleting backed-up rows",
    email_pending: "Sending backup email",
    completed: "Complete",
    email_failed: "Email needs retry",
    failed: "Needs attention",
  } as Record<string, string>)[status] ?? "Working";
}

function kindLabel(kind: Backup["backup_kind"]) {
  if (kind === "monthly_retention") return "Monthly retention";
  if (kind === "manual_all") return "Delete all snapshot";
  return "Delete-before snapshot";
}

export function ActivityLogBackupPanel() {
  const supabase = useMemo(() => createClient(), []);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [files, setFiles] = useState<Record<string, BackupFile[]>>({});
  const [beforeDate, setBeforeDate] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const loadGeneration = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    const result = await supabase.rpc("list_activity_log_backups", { p_limit: 20 });
    if (result.error || !Array.isArray(result.data)) throw result.error ?? new Error("invalid backups");
    const next = result.data as Backup[];
    const fileResults = await Promise.all(next.map(async (backup) => {
      const listed = await supabase.rpc("list_activity_log_backup_files", {
        p_backup_id: backup.backup_id,
      });
      return [backup.backup_id, listed.error || !Array.isArray(listed.data)
        ? [] : listed.data as BackupFile[]] as const;
    }));
    if (generation !== loadGeneration.current) return;
    setBackups(next);
    setFiles(Object.fromEntries(fileResults));
  }, [supabase]);

  useEffect(() => {
    // The initial RPC response is the external state this effect synchronizes.
    void load().catch(() => setError("Backup history could not be loaded."));
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      await load();
      setCurrentTime(Date.now());
      setError(null);
    } catch {
      setError("Backup history could not be refreshed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function createSnapshot(mode: "before_date" | "all") {
    if (busy) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await supabase.rpc("create_activity_log_manual_backup", {
        p_mode: mode,
        p_before_date: mode === "before_date" ? beforeDate : null,
      });
      if (result.error) throw result.error;
      setMessage("Snapshot queued. Refresh while the files are being prepared.");
      await load();
    } catch (caught) {
      const code = caught && typeof caught === "object" && "code" in caught
        ? String(caught.code) : "";
      setError(code === "CAL06"
        ? "Another Activity Log backup is still in progress. Finish it before starting a new one."
        : "The snapshot could not be started. Try again.");
    } finally { setBusy(false); }
  }

  async function downloadFile(backup: Backup, file: BackupFile) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(
        `/api/activity-log/backups/${backup.backup_id}/files/${file.file_id}/download`,
        { method: "GET", cache: "no-store" },
      );
      if (!response.ok) throw new Error("download failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.object_path.split("/").at(-1) ?? `activity-log-part-${file.part_number}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      await load();
      setMessage(`Downloaded file ${file.part_number}.`);
    } catch {
      setError("The backup file could not be downloaded. Try again.");
    } finally { setBusy(false); }
  }

  async function requestDeletion(backup: Backup) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await supabase.rpc("request_activity_log_backup_deletion", {
        p_backup_id: backup.backup_id,
        p_confirmation: confirmation,
      });
      if (result.error || result.data !== true) throw result.error ?? new Error("delete failed");
      setConfirmation(""); setSelectedId(null);
      setMessage("Deletion queued. Only rows in the downloaded snapshot can be removed.");
      await load();
    } catch {
      setError("Deletion was not queued. Check the downloads, expiry, and typed confirmation.");
    } finally { setBusy(false); }
  }

  async function retryEmail(backupId: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const result = await supabase.rpc("retry_activity_log_backup_email", {
        p_backup_id: backupId,
      });
      if (result.error || result.data !== true) throw result.error ?? new Error("retry failed");
      setMessage("Backup email queued for retry.");
      await load();
    } catch {
      setError("The backup email could not be queued for retry.");
    } finally { setBusy(false); }
  }

  return (
    <section className="grid gap-4 rounded-2xl border bg-card p-3.5 sm:p-4" aria-labelledby="activity-log-backups">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="activity-log-backups" className="font-display font-semibold">Backups and clearing</h2>
          <p className="text-sm text-muted-foreground">
            A stored snapshot is required before Activity Log entries can be cleared.
          </p>
        </div>
        <Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>
          <RefreshCw aria-hidden /> Refresh
        </Button>
      </div>

      <div className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
        <div className="grid gap-1.5">
          <label htmlFor="activity-log-delete-before" className="text-sm font-medium">Delete entries before</label>
          <Input id="activity-log-delete-before" type="date" value={beforeDate}
            onChange={(event) => setBeforeDate(event.target.value)} disabled={busy} />
        </div>
        <Button type="button" variant="outline" disabled={busy || !beforeDate}
          onClick={() => void createSnapshot("before_date")}>Create snapshot</Button>
        <Button type="button" variant="destructive" disabled={busy}
          onClick={() => void createSnapshot("all")}>
          <ShieldAlert aria-hidden /> Delete all snapshot
        </Button>
      </div>

      <MotionPresence open={Boolean(message || error)}>
        {message || error ? error ? <InlineAlert>{error}</InlineAlert> :
          <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
      </MotionPresence>

      <div className="grid gap-3">
        {backups.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No stored backups yet.</p>
        ) : backups.map((backup) => {
          const backupFiles = files[backup.backup_id] ?? [];
          const allDownloaded = backupFiles.length > 0 && backupFiles.every((file) => file.downloaded_by_caller);
          const expected = `DELETE ${backup.row_count} LOG ENTRIES`;
          const selected = selectedId === backup.backup_id;
          const unexpired = backup.delete_expires_at !== null && Date.parse(backup.delete_expires_at) > currentTime;
          return (
            <article key={backup.backup_id} className="grid gap-3 rounded-xl border p-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{kindLabel(backup.backup_kind)}</p>
                  <p className="text-xs text-muted-foreground">
                    {backup.row_count.toLocaleString()} rows · {backup.file_count.toLocaleString()} files · {statusLabel(backup.backup_status)}
                  </p>
                </div>
                {backup.backup_status === "email_failed" ? (
                  <Button type="button" size="sm" variant="outline" disabled={busy}
                    onClick={() => void retryEmail(backup.backup_id)}>
                    <ArchiveRestore aria-hidden /> Retry email
                  </Button>
                ) : null}
              </div>
              {backup.last_error_code ? (
                <p className="text-xs text-destructive">
                  Error code: {backup.last_error_code}
                </p>
              ) : null}
              {backupFiles.length ? (
                <div className="flex flex-wrap gap-2">
                  {backupFiles.map((file) => (
                    <Button key={file.file_id} type="button" size="sm" variant="outline" disabled={busy}
                      onClick={() => void downloadFile(backup, file)}>
                      <Download aria-hidden /> Part {file.part_number}{file.downloaded_by_caller ? " · downloaded" : ""}
                    </Button>
                  ))}
                </div>
              ) : null}
              {backup.backup_status === "ready" && !unexpired ? (
                <p className="text-xs text-destructive">
                  This deletion window expired. Create a fresh snapshot.
                </p>
              ) : null}
              {backup.backup_status === "ready" ? selected ? (
                <div className="grid gap-2 rounded-xl bg-muted/40 p-3">
                  <label htmlFor={`delete-confirm-${backup.backup_id}`} className="text-sm font-medium">
                    Type {expected}
                  </label>
                  <Input id={`delete-confirm-${backup.backup_id}`} value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)} disabled={busy} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="destructive"
                      disabled={busy || !allDownloaded || !unexpired || confirmation !== expected}
                      onClick={() => void requestDeletion(backup)}>
                      <Trash2 aria-hidden /> Delete backed-up rows
                    </Button>
                    <Button type="button" variant="outline" disabled={busy}
                      onClick={() => { setSelectedId(null); setConfirmation(""); }}>Cancel</Button>
                  </div>
                  {!allDownloaded ? <p className="text-xs text-muted-foreground">Download every file to enable deletion.</p> : null}
                </div>
              ) : (
                <Button type="button" variant="destructive" className="w-fit"
                  disabled={!allDownloaded || !unexpired}
                  onClick={() => { setSelectedId(backup.backup_id); setConfirmation(""); }}>
                  <Trash2 aria-hidden /> Continue to delete
                </Button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

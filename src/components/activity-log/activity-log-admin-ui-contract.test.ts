import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const client = readFileSync(
  join(root, "src/components/activity-log/activity-log-page.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const page = readFileSync(
  join(root, "src/app/(dashboard)/activity-log/page.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");
const backupPanel = readFileSync(
  join(root, "src/components/activity-log/activity-log-backup-panel.tsx"),
  "utf8",
).replace(/\r\n/g, "\n");

describe("Activity Log Admin controls", () => {
  it("derives the Admin capability on the guarded server page", () => {
    expect(page).toContain('const canManageActivityLog = profile.role === "Admin"');
    expect(page).toContain("canManageActivityLog\n      ? supabase.rpc(\"get_activity_log_retention_setting\")");
    expect(page).toContain("canManageActivityLog={canManageActivityLog}");
  });

  it("renders settings and export only inside the Admin capability branch", () => {
    const branch = client.slice(
      client.indexOf("{canManageActivityLog ? ("),
      client.indexOf("<div className=\"grid grid-cols", client.indexOf("{canManageActivityLog ? (")),
    );
    expect(branch).toContain("Retention and export");
    expect(branch).toContain("Export CSV");
    expect(branch).toContain("saveRetention");
  });

  it("keeps both mutations settled and uses the shared reduced-motion presence", () => {
    expect(client).toContain("finally {\n      setSavingRetention(false);");
    expect(client).toContain("finally {\n      setExporting(false);");
    expect(client).toContain("<MotionPresence open=");
  });

  it("settles the visible debounced search before fixing export filters", () => {
    const exportBody = client.slice(
      client.indexOf("async function exportCsv()"),
      client.indexOf("async function navigate", client.indexOf("async function exportCsv()")),
    );
    expect(client).toContain("searchTimer.current = null;\n      applySearch(value);");
    expect(client).toContain("const normalizedSearch = normalizeActivitySearch(value);");
    expect(exportBody).toContain("clearTimeout(searchTimer.current);");
    expect(exportBody).toContain("requestedSearch = applySearch(searchInput);");
    expect(exportBody.indexOf("requestedSearch = applySearch(searchInput);")).toBeLessThan(
      exportBody.indexOf("const requestedFilters = { ...filters, search: requestedSearch }"),
    );
  });

  it("preserves backup safety while applying the shared disclosure contract", () => {
    expect(backupPanel).toContain("window.setInterval(() => setCurrentTime(Date.now()), 1_000)");
    expect(backupPanel).toContain("Date.parse(backup.delete_expires_at) > now");
    expect(backupPanel).toContain("async function refresh()");
    expect(backupPanel).toContain('setError("Backup information could not be refreshed. Try again.")');
    expect(backupPanel).toContain("setCurrentTime(Date.now()); setError(null);");
    expect(backupPanel).toContain("finally { setBusy(false); }");
    expect(backupPanel).toContain("const generation = ++loadGeneration.current");
    expect(backupPanel).toContain("if (generation !== loadGeneration.current) return false");
    expect(backupPanel).toContain('throw listed.error ?? new Error("invalid backup files")');
    expect(backupPanel).not.toContain("? [] : listed.data as BackupFile[]");
    expect(backupPanel).toContain("<Collapse open={panelOpen}>");
    expect(backupPanel).toContain("<Collapse open={open}>");
    expect(backupPanel).toContain("<Collapse open={expanded}>");
    expect(backupPanel).toContain("motion-reduce:transition-none");
    expect(backupPanel).not.toContain("useModalHistory");
    expect(backupPanel).not.toContain("history.pushState");
  });

  it("keeps the exact deletion and download gates source-pinned", () => {
    expect(backupPanel).toContain("const expected = `DELETE ${backup.row_count} LOG ENTRIES`");
    expect(backupPanel).toContain("!allDownloaded(files[backup.backup_id] ?? [])");
    expect(backupPanel).toContain("confirmation !== expected");
    expect(backupPanel).toContain("!hasOpenWindow(backup, Date.now())");
    expect(backupPanel).toContain("disabled={busy || !downloaded || !unexpired || confirmation !== expected}");
    expect(backupPanel).toContain("/api/activity-log/backups/${backup.backup_id}/files/${file.file_id}/download");
    expect(backupPanel).toContain("retry_activity_log_backup_email");
    expect(backupPanel).toContain("Another Activity Log backup is still in progress. Finish it before starting a new one.");
  });

  it("maps only error codes persisted by the current migrations", () => {
    for (const code of [
      "email_delivery_failed",
      "snapshot_retry_pending",
      "deletion_retry_pending",
      "snapshot_attempts_exhausted",
      "snapshot_expired",
      "deletion_window_expired",
    ]) expect(backupPanel).toContain(code);
    expect(backupPanel).not.toContain("backup_worker_failed");
    expect(backupPanel).toContain("Error code: {backup.last_error_code}");
    expect(backupPanel).toContain("Math.ceil(remaining / 60_000)");
    expect(backupPanel).toContain("Delete window ends in less than a minute");
  });
});

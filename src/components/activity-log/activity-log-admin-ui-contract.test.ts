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

  it("advances backup expiry state and settles manual refresh failures", () => {
    expect(backupPanel).toContain("window.setInterval(() => setCurrentTime(Date.now()), 1_000)");
    expect(backupPanel).toContain("Date.parse(backup.delete_expires_at) > currentTime");
    expect(backupPanel).toContain("async function refresh()");
    expect(backupPanel).toContain('setError("Backup history could not be refreshed. Try again.")');
    expect(backupPanel).toContain("await load();\n      setCurrentTime(Date.now());\n      setError(null);");
    expect(backupPanel).toContain("finally {\n      setBusy(false);\n    }");
    expect(backupPanel).toContain("const generation = ++loadGeneration.current");
    expect(backupPanel).toContain("if (generation !== loadGeneration.current) return");
    expect(backupPanel).toContain("This deletion window expired. Create a fresh snapshot.");
    expect(backupPanel).toContain("disabled={!allDownloaded || !unexpired}");
  });
});

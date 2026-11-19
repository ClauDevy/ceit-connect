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
});

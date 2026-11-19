import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const path = join(
  process.cwd(),
  "supabase/migrations/20261124120000_activity_log_retention_settings_export.sql",
);
const migration = readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("Batch E1 Activity Log migration contract", () => {
  it("seeds 30 with bounded private metadata and no user/event/task foreign key", () => {
    expect(migration).toContain("create table ceit_connect_private.activity_log_settings");
    expect(migration).toContain("check (retention_days between 30 and 730)");
    expect(migration).toContain("updated_by uuid");
    expect(migration).not.toContain("updated_by uuid references");
    expect(migration).not.toMatch(/references public\.(users|events|tasks)/);
    expect(migration).toContain("values (true, 30, null)");
    expect(migration).toContain("enable row level security");
  });

  it("replaces only the retention helper and leaves the purge and guard alone", () => {
    expect(migration).toContain("create or replace function public.activity_log_retention_days()");
    expect(migration).toContain("language sql\nstable\nsecurity invoker\nset search_path = ''");
    expect(migration).not.toContain("create or replace function public.purge_activity_log");
    expect(migration).not.toContain("create function public.purge_activity_log");
    expect(migration).not.toContain("guard_activity_log_deletes");
    expect(migration).not.toContain("activity_log_guard_deletes");
  });

  it("authorizes setter and export before validation with one fixed denial", () => {
    for (const name of [
      "set_activity_log_retention_days",
      "list_activity_log_export",
    ]) {
      const start = migration.indexOf(`create function public.${name}`);
      const end = migration.indexOf("$$;", start);
      const body = migration.slice(start, end);
      expect(body.indexOf("if not exists (")).toBeGreaterThanOrEqual(0);
      expect(body.indexOf("if not exists (")).toBeLessThan(
        body.indexOf("p_page_size is null") >= 0
          ? body.indexOf("p_page_size is null")
          : body.indexOf("p_retention_days is null"),
      );
      expect(body).toContain("Activity Log administration is unavailable.");
    }
    expect(migration.match(/Activity Log administration is unavailable\./g))
      .toHaveLength(3);
  });

  it("delegates export masking and filters to the existing safe reader", () => {
    const exportStart = migration.indexOf("create function public.list_activity_log_export");
    const exportBody = migration.slice(exportStart);
    expect(exportBody).toContain("from public.list_activity_log(");
    for (const argument of [
      "p_sort => p_sort",
      "p_action => p_action",
      "p_committee_id => p_committee_id",
      "p_date_from => p_date_from",
      "p_date_to => p_date_to",
      "p_search => p_search",
    ]) expect(exportBody).toContain(argument);
    expect(exportBody).not.toContain("from public.activity_log");
    expect(exportBody).not.toContain("-> 'changes'");
    expect(exportBody).toContain("profile.role = 'Admin'");
  });

  it("does not schedule or invoke the purge", () => {
    expect(migration).not.toContain("cron.schedule");
    expect(migration).not.toContain("select public.purge_activity_log()");
  });
});

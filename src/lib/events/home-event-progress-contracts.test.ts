import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const migrationName = "20261025120000_home_event_progress.sql";
const migration = readFileSync(
  join(migrationsDirectory, migrationName),
  "utf8",
).toLowerCase();
const allMigrations = readdirSync(migrationsDirectory)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => readFileSync(join(migrationsDirectory, name), "utf8"))
  .join("\n")
  .toLowerCase();

describe("tracked Home event progress contract", () => {
  it("adds one bounded fixed-shape reader without an overload", () => {
    expect(
      allMigrations.match(
        /create(?: or replace)? function public\.list_home_event_progress\s*\(/g,
      ),
    ).toHaveLength(1);
    expect(migration).toContain(
      "create function public.list_home_event_progress(p_event_ids uuid[])",
    );
    expect(migration).toContain("pg_catalog.cardinality(p_event_ids) > 20");
    expect(migration).toContain("out_phase_label text");
    expect(migration).not.toContain("out_task_id");
    expect(migration).not.toContain("out_title");
  });

  it("pins the owner, fixed path, stable definer mode, and grants", () => {
    expect(migration).toMatch(/language plpgsql\s+stable\s+security definer/);
    expect(migration).toContain("set search_path = ''");
    expect(migration).toContain(
      "alter function public.list_home_event_progress(uuid[]) owner to postgres",
    );
    expect(migration).toContain(
      "revoke all on function public.list_home_event_progress(uuid[])",
    );
    expect(migration).toContain(
      "grant execute on function public.list_home_event_progress(uuid[])",
    );
    expect(migration).toMatch(/to authenticated;/);
  });

  it("keeps board-equivalent ordering, numeric progress, and null-safe Backlog", () => {
    expect(migration).toContain("pg_catalog.btrim(task_row.phase)");
    expect(migration).toContain(
      "summary.task_id order by summary.sort_order, summary.task_id",
    );
    expect(migration).toContain(
      "totals.completed_task_count::numeric * 100",
    );
    expect(migration).not.toContain("double precision");
    expect(migration).toMatch(
      /coalesce\(\s*pg_catalog\.cardinality\(summary\.primary_assignees\),\s*0\s*\) = 0/,
    );
  });

  it("is Active-only and limits backup counts to real incomplete tasks", () => {
    expect(migration).toContain("v_caller_id uuid := auth.uid()");
    expect(migration).toContain("caller.is_active is true");
    expect(migration).toContain("event_row.status = 'active'");
    expect(migration).toContain(
      "access_row.content_access in ('real', 'masked')",
    );
    expect(migration).toMatch(
      /summary\.content_access = 'real'\s+and summary\.request_backup is true\s+and summary\.status <> 'completed'/,
    );
  });
});

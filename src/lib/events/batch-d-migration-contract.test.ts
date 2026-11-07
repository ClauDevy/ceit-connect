import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261108120000_event_auto_archive.sql",
  "utf8",
);
const paste = readFileSync("docs/phase-4b/step-d-tests.md", "utf8");
const plan = readFileSync("docs/phase-4b/step-d.md", "utf8");

describe("Batch D automatic archive migration contract", () => {
  it("uses three complete Manila days and leaves scheduling out of the migration", () => {
    expect(migration).toContain("as $$ select 3::integer $$");
    expect(migration).toContain("'Asia/Manila'");
    expect(migration).toContain("v_today > event_row.end_date + public.event_auto_archive_grace_days()");
    expect(migration).not.toContain("cron.schedule");
    expect(plan).toContain("'5 16 * * *'");
    expect(plan).toContain("16:05 UTC");
    expect(plan).toContain("00:05 Asia/Manila");
  });

  it("captures and backfills an exact archive-time unfinished count", () => {
    expect(migration).toContain("add column archived_unfinished_task_count bigint");
    expect(migration).toContain("where event_row.status = 'Archived'");
    expect(migration).toContain("when (old.status = 'Active' and new.status = 'Archived')");
    expect(migration.match(/task_row\.status <> 'Completed'/g)?.length).toBeGreaterThanOrEqual(3);
    expect(migration).toContain("status = 'Archived' and archived_unfinished_task_count is not null");
    expect(paste).toContain("manual archive count equals stored count");
    expect(paste).toContain("snapshot does not fire for Active metadata edit");
    expect(paste).toContain("snapshot does not fire for Draft metadata edit");
  });

  it("blocks only clearing an existing Active end date and preserves Batch 13d", () => {
    expect(migration).toContain("if old.status = 'Active'\n     and new.status = 'Active'\n     and old.end_date is not null\n     and new.end_date is null then");
    expect(migration).toContain("errcode = 'CCD06'");
    expect(migration).toContain("if old.status = 'Draft' and new.status = 'Active' then\n    if new.end_date is null then\n      raise exception 'An Active event requires an end date.';");
    expect(migration).toContain("errcode = 'CCE01'");
    expect(migration).toContain("errcode = 'CCE04'");
    expect(migration).toContain("service_role, ceit_event_delete_executor");
    expect(paste).toContain("legacy null-end Active archives manually");
    expect(paste).toContain("legacy null-end Active remains editable");
    expect(paste).toContain("same save extends end date and moves task later");
  });

  it("keeps the runner private, capped, rechecked, and bounded", () => {
    expect(migration).toContain("if session_user <> 'postgres' then");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("limit 100");
    expect(migration).toContain("'Automatic archive failed.'");
    expect(migration).not.toMatch(/error_message\s+text(?![\s\S]*Automatic archive failed)/);
    expect(paste).toContain("normal role cannot invoke runner");
    expect(paste).toContain("extension wins through per-event recheck");
    expect(paste).toContain("runner cap is exactly 100 attempts");
    const itemInsert = migration.indexOf("insert into ceit_connect_private.event_auto_archive_run_items(");
    const archivedIncrement = migration.indexOf("out_archived_count := out_archived_count + 1;");
    expect(itemInsert).toBeGreaterThan(-1);
    expect(archivedIncrement).toBeGreaterThan(itemInsert);
    expect(paste).toContain("anonymous cron path archives and cancels pending leave without failure");
  });

  it("keeps item event ids non-relational and operational history private", () => {
    const itemTable = migration.slice(
      migration.indexOf("create table ceit_connect_private.event_auto_archive_run_items"),
      migration.indexOf("revoke all on table ceit_connect_private.event_auto_archive_runs"),
    );
    expect(itemTable).toContain("event_id uuid not null");
    expect(itemTable).not.toMatch(/event_id[\s\S]*references public\.events/);
    expect(migration).toContain("as $$ select 30::integer $$");
    expect(migration).toContain("limit 500");
    expect(paste).toContain("run-item history survives event deletion");
    expect(paste).toContain("Draft event deletion still succeeds");
  });

  it("makes warning behavior role-safe and confidentiality-safe", () => {
    expect(migration).toContain("caller.role in ('Admin', 'Co-Admin', 'Member')");
    expect(migration).toContain("and caller.is_active");
    expect(migration).toContain("grant execute on function public.get_event_auto_archive_warning(uuid)");
    for (const label of [
      "warning helper reports three days",
      "warning helper reports one day",
      "warning helper reports zero days",
      "warning helper is absent on end date",
      "Draft has no warning",
      "Archived has no warning",
      "active Co-Admin can read warning",
      "inactive user is rejected",
      "Active warning includes confidential unfinished count only",
    ]) {
      expect(paste).toContain(label);
    }
    expect(plan).toContain("includes confidential tasks as a **number only**");
  });

  it("uses the approved rollback paste shape and exact line count", () => {
    expect(paste).toContain("create table batch_d_results");
    expect(paste).not.toContain("create temporary table");
    expect(paste).not.toMatch(/^perform\b/gm);
    expect(paste).toContain("set local role authenticated");
    expect(paste).toContain("Expected 46 result lines");
    expect(paste).toContain("46/46 PASS");
    expect(paste).toContain("date '1000-01-02'");
    expect(paste).toContain("date '1100-01-02'");
    expect(paste).toContain("set_config('ceit_connect.task_access_writer','create_active_event_task',true)");
    expect(paste).toContain("set_config('ceit_connect.task_assignee_writer','create_event_with_tasks',true)");
  });
});

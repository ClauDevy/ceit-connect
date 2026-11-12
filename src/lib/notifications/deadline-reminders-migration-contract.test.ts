import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readText = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const migrationName = "20261116120000_deadline_reminders.sql";
const migration = readText(`supabase/migrations/${migrationName}`);
const catalogPaste = readText(
  "docs/phase-5/step-r2-deadline-reminders-catalog-tests.md",
);
const behaviorPaste = readText(
  "docs/phase-5/step-r2-deadline-reminders-behavior-tests.md",
);
const step = readText("docs/phase-5/step-r2-deadline-reminders.md");
const migrationFiles = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

describe("Phase 5 R2 deadline-reminder migration contract", () => {
  it("uses a new immutable migration after R1", () => {
    expect(migrationFiles.indexOf("20261115120000_request_notifications.sql")).toBeGreaterThanOrEqual(0);
    expect(migrationFiles.indexOf(migrationName)).toBeGreaterThan(
      migrationFiles.indexOf("20261115120000_request_notifications.sql"),
    );
    expect(migration).toContain("The environment-specific pg_cron job is created manually on Prod only.");
    expect(migration).not.toMatch(/cron\.schedule|insert\s+into\s+cron\.job/i);
  });

  it("adds both types to constraints, helper allowlist, push copy, and bell contract", () => {
    for (const type of ["task_due_soon", "live_operation_prep"]) {
      expect(migration.match(new RegExp(`'${type}'`, "g"))?.length).toBeGreaterThanOrEqual(5);
    }
    expect(migration).toContain("when 'task_due_soon' then 'A task is due soon.'");
    expect(migration).toContain(
      "when 'live_operation_prep' then 'A Live Operation call time is soon.'",
    );
    expect(step).toContain("`{task title} is due soon.`");
    expect(step).toContain("`Prepare for {task title}. Call time is soon.`");
  });

  it("uses exact per-person occurrence keys and an idempotent silent bootstrap", () => {
    expect(migration).toContain(
      "primary key (task_id, reminder_kind, target_at, user_id)",
    );
    expect(migration).toContain(
      "create function ceit_connect_private.bootstrap_deadline_reminders_at(",
    );
    expect(migration).toContain(
      "on conflict (task_id, reminder_kind, target_at, user_id) do nothing",
    );
    const bootstrap = migration.slice(
      migration.indexOf("create function ceit_connect_private.bootstrap_deadline_reminders_at("),
      migration.indexOf("create function ceit_connect_private.emit_deadline_reminder_occurrence("),
    );
    expect(bootstrap).not.toContain("insert into public.notifications");
    expect(migration).toContain(
      "perform ceit_connect_private.bootstrap_deadline_reminders_at(",
    );
  });

  it("filters fully-ledgered occurrences before earliest-first cap", () => {
    const runner = migration.slice(
      migration.indexOf("create function ceit_connect_private.run_deadline_reminders_at("),
      migration.indexOf("create function public.run_deadline_reminders()"),
    );
    expect(runner).toContain("where exists (");
    expect(runner).toContain("task_deadline_reminder_ledger as ledger_row");
    expect(runner.indexOf("where exists (")).toBeLessThan(runner.indexOf("limit public.deadline_reminder_batch_size()"));
    expect(runner).toContain(
      "order by occurrence.target_at,\n             occurrence.reminder_kind,\n             occurrence.task_id",
    );
    expect(migration).toContain("select 100;");
    expect(behaviorPaste).toContain(
      "second run handles the remaining one while first 100 remain in-window",
    );
  });

  it("pins Active, open, active-recipient, due, call, and end-time rules", () => {
    expect(migration).toContain("event_row.status = 'Active'");
    expect(migration).toContain("task_row.status <> 'Completed'");
    expect(migration).toContain("profile.is_active is true");
    expect(migration).toContain("task_row.due_date <= p_as_of + interval '24 hours'");
    expect(migration).toContain("task_row.task_type = 'LiveOperation'");
    expect(migration).toContain("task_row.call_time <= p_as_of + interval '2 hours'");
    expect(migration).not.toMatch(/end_time\s*[<=>]/);
  });

  it("keeps every runner boundary away from application and service roles", () => {
    for (const signature of [
      "bootstrap_deadline_reminders_at(timestamptz)",
      "emit_deadline_reminder_occurrence(\n  uuid, text, timestamptz, timestamptz\n)",
      "purge_deadline_reminder_ledger(timestamptz)",
      "purge_deadline_reminder_runs(timestamptz, uuid)",
      "run_deadline_reminders_at(timestamptz)",
    ]) {
      expect(migration).toContain(`revoke all on function ceit_connect_private.${signature}`);
    }
    expect(migration).toContain(
      "revoke all on function public.run_deadline_reminders()\nfrom public, anon, authenticated, service_role",
    );
    expect(migration).not.toMatch(/grant execute[^;]*service_role/i);
  });

  it("returns one safe six-field row and retains bounded cleanup", () => {
    expect(migration).toContain("out_occurrences_handled integer");
    expect(migration).toContain("out_notifications_created integer");
    expect(migration).toContain("out_skipped_concurrent boolean");
    expect(migration).toContain("out_ledger_rows_cleaned integer");
    expect(migration).toContain("out_run_history_rows_cleaned integer");
    expect(migration).toContain("out_status text");
    expect(migration).toContain("limit 500\n    for update skip locked");
    expect(migration).toContain("notifications_created >= 0");
    expect(migration).not.toContain("notifications_created between 0 and 10000");
    expect(migration).toContain("Completed with failures.");
    expect(migration).toContain("Skipped because another reminder run is active.");
  });

  it("pins both complete self-contained Dev pastes", () => {
    for (const paste of [catalogPaste, behaviorPaste]) {
      expect(paste).toContain("Run without RLS");
      expect(paste).toContain("insert into auth.users");
      expect(paste).toMatch(/set_config\('request\.jwt\.claims'/);
      expect(paste).not.toMatch(/create\s+(?:temporary|temp)\s+table/i);
      expect(paste).not.toContain("\\gset");
    }
    expect(catalogPaste).toContain("records exactly **25** result rows");
    expect(catalogPaste).toContain("TEST RESULTS 25/25 PASS");
    expect(behaviorPaste).toContain("records exactly **26** result rows");
    expect(behaviorPaste).toContain("TEST RESULTS 26/26 PASS");
    expect(behaviorPaste).toContain("bootstrap creates no notifications");
    expect(behaviorPaste).toContain("person assigned after bootstrap receives one reminder");
  });

  it("documents exact replacements and owner-only cron lifecycle", () => {
    expect(step).toContain("## Latest replacements: old versus new");
    expect(step).toContain("`ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])`");
    expect(step).toContain("`public.claim_push_deliveries(integer)`");
    expect(step).toContain("'ceit-connect-deadline-reminders'");
    expect(step).toContain("'*/15 * * * *'");
    expect(step).toContain("cron.job_run_details");
    expect(step).toContain("cron.unschedule(v_job_id)");
  });
});

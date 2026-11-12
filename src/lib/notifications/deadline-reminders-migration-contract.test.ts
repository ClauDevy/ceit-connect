import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readText = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const migrationName = "20261116120000_deadline_reminders.sql";
const migration = readText(`supabase/migrations/${migrationName}`);
const retryMigrationName = "20261117120000_deadline_reminder_retry_backoff.sql";
const retryMigration = readText(`supabase/migrations/${retryMigrationName}`);
const catalogPaste = readText(
  "docs/phase-5/step-r2-deadline-reminders-catalog-tests.md",
);
const behaviorPaste = readText(
  "docs/phase-5/step-r2-deadline-reminders-behavior-tests.md",
);
const retryPaste = readText(
  "docs/phase-5/step-r2-deadline-reminder-retry-tests.md",
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
    expect(migrationFiles.indexOf(retryMigrationName)).toBeGreaterThan(
      migrationFiles.indexOf(migrationName),
    );
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
      migration.indexOf("alter function ceit_connect_private.bootstrap_deadline_reminders_at("),
    );
    expect(bootstrap).toContain(
      "if not pg_catalog.pg_has_role(session_user, 'postgres', 'MEMBER') then",
    );
    expect(bootstrap).toContain(
      "raise exception using errcode = '42501', message = 'Postgres session required.';",
    );
    expect(bootstrap).not.toContain("if session_user <> 'postgres' then");
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

    for (const [start, end] of [
      [
        "create function ceit_connect_private.emit_deadline_reminder_occurrence(",
        "alter function ceit_connect_private.emit_deadline_reminder_occurrence(",
      ],
      [
        "create function ceit_connect_private.purge_deadline_reminder_ledger(",
        "alter function ceit_connect_private.purge_deadline_reminder_ledger(",
      ],
      [
        "create function ceit_connect_private.purge_deadline_reminder_runs(",
        "alter function ceit_connect_private.purge_deadline_reminder_runs(",
      ],
      [
        "create function ceit_connect_private.run_deadline_reminders_at(",
        "alter function ceit_connect_private.run_deadline_reminders_at(",
      ],
    ]) {
      const definition = migration.slice(migration.indexOf(start), migration.indexOf(end));
      expect(definition).toContain("if session_user <> 'postgres' then");
    }

    const publicRunner = migration.slice(
      migration.indexOf("create function public.run_deadline_reminders()"),
      migration.indexOf("alter function public.run_deadline_reminders()"),
    );
    expect(publicRunner).toContain("ceit_connect_private.run_deadline_reminders_at(");
    expect(publicRunner).toContain("pg_catalog.clock_timestamp()");
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
    for (const type of [
      "mention",
      "heads_up",
      "assignment",
      "status_change",
      "unlock",
      "backup_request",
      "volunteer_offer",
      "leave_requested",
      "leave_cancelled",
      "leave_approved",
      "leave_denied",
      "task_due_soon",
      "live_operation_prep",
    ]) {
      expect(catalogPaste).toContain(`('${type}')`);
    }
    expect(catalogPaste).toContain("and 26=(select count(*)");
    expect(behaviorPaste).toContain("records exactly **26** result rows");
    expect(behaviorPaste).toContain("TEST RESULTS 26/26 PASS");
    expect(behaviorPaste).toContain("bootstrap creates no notifications");
    expect(behaviorPaste).toContain("person assigned after bootstrap receives one reminder");
    expect(retryPaste).toContain("Run without RLS");
    expect(retryPaste).toContain("insert into auth.users");
    expect(retryPaste).not.toMatch(/create\s+(?:temporary|temp)\s+table/i);
    expect(retryPaste).toContain("TEST RESULTS 12/12 PASS");
    expect(retryPaste).toContain(
      "one recipient failure does not block a healthy recipient or later occurrence",
    );
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

  it("keeps failed occurrences outside the cap until bounded retry", () => {
    expect(retryMigration).toContain(
      "create table ceit_connect_private.deadline_reminder_retry_state",
    );
    expect(retryMigration).toContain(
      "primary key (task_id, reminder_kind, target_at, user_id)",
    );
    expect(retryMigration).toContain("failure_count between 1 and 5");
    const retryTable = retryMigration.slice(
      retryMigration.indexOf(
        "create table ceit_connect_private.deadline_reminder_retry_state",
      ),
      retryMigration.indexOf(
        "alter table ceit_connect_private.deadline_reminder_retry_state owner",
      ),
    );
    expect(retryTable).toContain("user_id uuid not null");
    expect(retryTable).not.toMatch(/task_title|description/);

    const runner = retryMigration.slice(
      retryMigration.indexOf(
        "create or replace function ceit_connect_private.run_deadline_reminders_at(",
      ),
      retryMigration.indexOf(
        "alter function ceit_connect_private.run_deadline_reminders_at(",
      ),
    );
    expect(runner.indexOf("deadline_reminder_retry_state as retry_row")).toBeLessThan(
      runner.indexOf("limit public.deadline_reminder_batch_size()"),
    );
    expect(runner).toContain("retry_row.failure_count >= 5");
    expect(runner).toContain("retry_row.next_retry_at > p_as_of");
    expect(runner).toContain("retry_row.user_id = proposed.user_id");
    expect(runner).toContain("for v_recipient in");
    expect(runner).toContain("v_recipient_sqlstate := null;");
    expect(runner).toContain("get stacked diagnostics v_recipient_sqlstate = returned_sqlstate;");
    expect(runner.indexOf("if v_recipient_sqlstate is null then")).toBeGreaterThan(
      runner.indexOf("exception when others then"),
    );
    expect(runner).toContain(
      "v_candidate.target_at,\n          v_recipient.user_id,\n          p_as_of",
    );
    expect(runner).toContain(
      "on conflict (task_id, reminder_kind, target_at, user_id) do update",
    );
    for (const delay of ["15 minutes", "30 minutes", "1 hour", "2 hours"]) {
      expect(runner).toContain(`interval '${delay}'`);
    }
    expect(runner).toContain(
      "delete from ceit_connect_private.deadline_reminder_retry_state as retry_row",
    );
  });

  it("uses a fresh final clock only for the ungranted production runner", () => {
    const emitter = retryMigration.slice(
      retryMigration.lastIndexOf(
        "create or replace function ceit_connect_private.emit_deadline_reminder_occurrence(",
      ),
      retryMigration.lastIndexOf(
        "alter function ceit_connect_private.emit_deadline_reminder_occurrence(",
      ),
    );
    expect(emitter).toContain(
      "pg_catalog.current_setting('ceit_connect.deadline_reminder_live_clock', true) = 'on'",
    );
    expect(emitter).toContain("then pg_catalog.clock_timestamp()");
    expect(emitter).toContain("else p_as_of");
    expect(emitter).toContain("p_user_id uuid");
    expect(emitter).toContain("on profile.id = p_user_id");

    const publicRunner = retryMigration.slice(
      retryMigration.lastIndexOf("create or replace function public.run_deadline_reminders()"),
    );
    expect(publicRunner).toContain(
      "pg_catalog.set_config('ceit_connect.deadline_reminder_live_clock', 'on', true)",
    );
    expect(publicRunner).toContain("v_previous_live_clock");
    expect(publicRunner).toContain("if session_user <> 'postgres' then");
    expect(publicRunner).toContain("exception when others then");
    expect(
      publicRunner.match(/reset ceit_connect\.deadline_reminder_live_clock/g),
    ).toHaveLength(2);
    expect(publicRunner).toContain("pg_catalog.clock_timestamp()");
    expect(publicRunner).toContain(
      "revoke all on function public.run_deadline_reminders()\nfrom public, anon, authenticated, service_role",
    );
  });

  it("keeps retry state private and cleanup bounded", () => {
    expect(retryMigration).toContain(
      "alter table ceit_connect_private.deadline_reminder_retry_state enable row level security",
    );
    expect(retryMigration).toContain(
      "revoke all on table ceit_connect_private.deadline_reminder_retry_state\nfrom public, anon, authenticated, service_role",
    );
    expect(retryMigration).toContain(
      "revoke all on function ceit_connect_private.purge_deadline_reminder_retry_state(timestamptz)\nfrom public, anon, authenticated, service_role",
    );
    expect(retryMigration).toContain(
      "revoke all on function ceit_connect_private.emit_deadline_reminder_occurrence(\n  uuid, text, timestamptz, uuid, timestamptz\n) from public, anon, authenticated, service_role",
    );
    expect(retryMigration).toContain("if session_user <> 'postgres' then");
    expect(retryMigration).toContain("limit 500\n    for update skip locked");
    expect(retryMigration).not.toMatch(/grant execute[^;]*service_role/i);
    expect(step).toContain("20261117120000_deadline_reminder_retry_backoff.sql");
    expect(retryPaste).toContain(
      "repeated failures cap one recipient while a new assignee still receives",
    );
    expect(retryPaste).toContain(
      "conflict update increments failure and lengthens backoff",
    );
    expect(retryPaste).toContain(
      "one recipient failure does not block a healthy recipient or later occurrence",
    );
    expect(step).toContain("Never approve a\nfailed scheduled rollout from a later manual run.");
  });
});

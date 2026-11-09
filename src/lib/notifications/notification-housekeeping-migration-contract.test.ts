import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readText = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const migration = readText(
  "supabase/migrations/20261111120000_notification_housekeeping.sql",
);
const catalogPaste = readText(
  "docs/phase-5/step-n3a-notification-housekeeping-catalog-tests.md",
);
const behaviorPaste = readText(
  "docs/phase-5/step-n3a-notification-housekeeping-behavior-tests.md",
);
const historyDefinition = migration.slice(
  migration.indexOf(
    "create table ceit_connect_private.notification_cleanup_runs",
  ),
  migration.indexOf(
    "create index notification_cleanup_runs_finished_at_id_idx",
  ),
);

describe("Phase 5 N3a notification housekeeping migration contract", () => {
  it("keeps deletion behind active-owner wrappers", () => {
    expect(migration).toContain(
      "where notification_row.id = p_notification_id\n    and notification_row.user_id = p_user_id",
    );
    expect(migration).toContain("where profile.id = v_caller_id\n      and profile.is_active is true");
    expect(migration).toContain(
      "grant execute on function public.delete_notification(uuid) to authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.clear_read_notifications() to authenticated",
    );
    expect(migration).not.toMatch(/grant delete on (table )?public\.notifications/i);
    expect(migration).not.toMatch(/create policy/i);
    expect(migration).toContain(
      "where notification_row.user_id = p_user_id\n      and notification_row.read_at is not null\n    order by notification_row.id\n    for update of notification_row skip locked",
    );
  });

  it("deletes only read rows and bounds automatic cleanup oldest-first", () => {
    expect(migration).toContain("notification_row.read_at is not null");
    expect(migration).toContain("notification_row.read_at < p_cutoff_at");
    expect(migration).toContain(
      "order by notification_row.read_at, notification_row.id",
    );
    expect(migration).toContain("limit public.notification_cleanup_batch_size()");
    expect(migration).toContain("for update of notification_row skip locked");
    expect(migration).toContain("as $$ select 60 $$");
    expect(migration).toContain("as $$ select 500 $$");
  });

  it("keeps the runner and aggregate history private", () => {
    const runnerDefinition = migration.slice(
      migration.indexOf("create function public.run_notification_cleanup()"),
      migration.indexOf("alter function public.run_notification_cleanup()"),
    );
    const notificationPurgeDefinition = migration.slice(
      migration.indexOf(
        "create function ceit_connect_private.purge_old_read_notifications(",
      ),
      migration.indexOf(
        "alter function ceit_connect_private.purge_old_read_notifications(timestamptz)",
      ),
    );
    const historyPurgeDefinition = migration.slice(
      migration.indexOf(
        "create function ceit_connect_private.purge_notification_cleanup_runs()",
      ),
      migration.indexOf(
        "alter function ceit_connect_private.purge_notification_cleanup_runs()",
      ),
    );

    expect(runnerDefinition).toContain("if session_user <> 'postgres'");
    expect(notificationPurgeDefinition).toContain(
      "if session_user <> 'postgres'",
    );
    expect(historyPurgeDefinition).toContain(
      "if session_user <> 'postgres'",
    );
    expect(migration).toContain(
      "pg_catalog.hashtextextended('ceit-connect:notification-cleanup', 0)",
    );
    expect(migration).toContain(
      "revoke all on function public.run_notification_cleanup()\nfrom public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "alter table ceit_connect_private.notification_cleanup_runs enable row level security",
    );
    expect(migration).toContain("as $$ select 30 $$");
    expect(historyDefinition).not.toMatch(
      /notification_id|user_id|task_id|event_id|comment_id/,
    );
  });

  it("pins both rollback-safe Dev pastes", () => {
    for (const paste of [catalogPaste, behaviorPaste]) {
      expect(paste).toContain("Run without RLS");
      expect(paste).toContain("insert into auth.users");
      expect(paste).not.toMatch(/create\s+temporary\s+table/i);
      expect(paste).not.toContain("\\gset");
    }
    expect(catalogPaste).toContain("records exactly **38** result rows");
    expect(catalogPaste).toContain("TEST RESULTS 38/38 PASS");
    expect(behaviorPaste).toContain("records exactly **32** result rows");
    expect(behaviorPaste).toContain("TEST RESULTS 32/32 PASS");
    expect(behaviorPaste).toContain(
      "delete from public.notifications as notification_row",
    );
    expect(behaviorPaste).toContain("first runner deletes bounded maximum 500");
    expect(behaviorPaste).toContain(
      "automatic cleanup never removes unread rows",
    );
  });
});

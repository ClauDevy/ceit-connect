import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readText = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const migration = readText(
  "supabase/migrations/20261110120000_notification_foundation.sql",
);
const housekeepingMigration = readText(
  "supabase/migrations/20261111120000_notification_housekeeping.sql",
);
const catalogPaste = readText(
  "docs/phase-5/step-n1-notification-foundation-catalog-tests.md",
);
const behaviorPaste = readText(
  "docs/phase-5/step-n1-notification-foundation-behavior-tests.md",
);
const step = readText("docs/phase-5/step-n1-notification-foundation.md");
const migrationFiles = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();
const initialNotifications = readText(
  "supabase/migrations/20260926053015_notifications_and_activity_log.sql",
);
const draftVisibility = readText(
  "supabase/migrations/20261030130000_draft_task_visibility.sql",
);
const latestClaim = readText(
  "supabase/migrations/20261027120000_task_assignee_locking.sql",
);
const taskRules = readText(
  "supabase/migrations/20261029150000_task_rules.sql",
);
const backupWriter = readText(
  "supabase/migrations/20261022120000_task_claim_backup_volunteers.sql",
);
const peerAdmin = readText(
  "supabase/migrations/20261106130000_peer_admin_lifecycle.sql",
);

describe("Phase 5 N1 notification foundation migration contract", () => {
  it("orders housekeeping after N1 without replacing the notification policy pair", () => {
    expect(migrationFiles.slice(-8)).toEqual([
      "20261111120000_notification_housekeeping.sql",
      "20261112120000_web_push_database.sql",
      "20261113120000_executive_dashboard_data.sql",
      "20261114120000_executive_dashboard_extras_data.sql",
      "20261115120000_request_notifications.sql",
      "20261116120000_deadline_reminders.sql",
      "20261117120000_deadline_reminder_retry_backoff.sql",
      "20261118120000_mention_notification_comment_targets.sql",
    ]);
    const priorSql = migrationFiles
      .filter((name) => name < "20261110120000_notification_foundation.sql")
      .map((name) => readText(`supabase/migrations/${name}`))
      .join("\n");
    expect(
      priorSql.match(/create policy "notifications_select_own"/gi),
    ).toHaveLength(1);
    expect(
      priorSql.match(/create policy "notifications_update_own"/gi),
    ).toHaveLength(1);
    expect(initialNotifications).toContain("using (user_id = auth.uid());");
    expect(migration).toContain(
      "notification policies differ from the latest pre-N1 or N1 definitions",
    );
    expect(housekeepingMigration).not.toMatch(/create policy/i);
    expect(housekeepingMigration).not.toMatch(/drop policy/i);
  });

  it("keeps Realtime read-only and personal", () => {
    expect(migration).toContain(
      "revoke insert, update, delete on table public.notifications from authenticated;",
    );
    expect(migration).toContain(
      "grant select on table public.notifications to authenticated;",
    );
    expect(migration).toContain("user_id = auth.uid()\n  and public.my_role() is not null");
    expect(migration).toContain("using (false)\nwith check (false)");
    expect(migration).toContain(
      "alter publication supabase_realtime add table public.notifications;",
    );
    expect(migration).toContain("publication.puballtables");
    expect(migration).toContain("publication_table.tablename = 'notifications'");
  });

  it("creates all six types only through private set-wise writers", () => {
    for (const type of [
      "mention",
      "heads_up",
      "assignment",
      "status_change",
      "unlock",
      "backup_request",
    ]) {
      expect(migration).toContain(`'${type}'`);
    }
    expect(migration).toContain("select distinct proposed.user_id");
    expect(migration).toContain("profile.is_active is true");
    expect(migration).toContain("proposed.user_id is distinct from p_actor_id");
    expect(migration).toContain("dependent_event.status = 'Active'");
    expect(migration).toContain("dependent.status <> 'Completed'");
    expect(migration).toContain("old.status is distinct from 'Completed'");
    expect(migration).toContain("new.status = 'Completed'");
    expect(migration).not.toMatch(/for\s+v_(?:task|dependent)\s+in/i);
    expect(migration).toContain(
      "select distinct recipient.user_id, 'unlock', dependent.id",
    );
    expect(migration).toContain(
      "select distinct recipient.user_id, 'assignment', task_row.id",
    );
  });

  it("keeps launch, draft, archive, no-op, and leave behavior explicit", () => {
    expect(migration).toContain("if v_event_status is distinct from 'Active' then");
    expect(migration).toContain("if old.status = 'Draft' and new.status = 'Active' then");
    expect(migration).toContain("new.status is distinct from old.status");
    expect(migration).toContain("old.request_backup is distinct from true");
    expect(migration).toContain("notification_suppression_context");
    expect(migration).toContain("pg_catalog.pg_current_xact_id()");
    expect(
      migration.indexOf(
        "delete from ceit_connect_private.notification_suppression_context",
      ),
    ).toBeLessThan(migration.indexOf("select event_row.status"));
    expect(step).toContain("Leave request/cancel/deny");
    expect(step).toContain("Former-member eligibility/anonymization");
    expect(step).toContain("Active→Archived / auto-archive");
  });

  it("uses thin active-user readers and masks through latest task access", () => {
    expect(migration).toContain(
      "return ceit_connect_private.notification_unread_count_for_user(v_caller_id);",
    );
    expect(migration).toContain(
      "from ceit_connect_private.list_notifications_for_user(",
    );
    expect(migration).toContain("public.task_content_access_for_user(");
    expect(migration).toContain("when notification_row.content_access = 'hidden' then null::uuid");
    expect(migration).toContain("then notification_row.stored_task_title");
    expect(migration).toContain("else 'Confidential Task'");
    expect(migration).toContain("where profile.id = v_caller_id\n      and profile.is_active is true");
    expect(migration).not.toMatch(/insert into public\.notifications\s*\([^)]*title/i);
  });

  it("pins the two self-contained Dev paste ledgers", () => {
    expect(catalogPaste).toContain("records exactly **30** result rows");
    expect(catalogPaste).toContain("TEST RESULTS 30/30 PASS");
    expect(behaviorPaste).toContain("records exactly **48** result rows");
    expect(behaviorPaste).toContain("TEST RESULTS 48/48 PASS");
    expect(behaviorPaste).toContain("N1 Draft");
    expect(behaviorPaste).toContain("N1 Archive");
    expect(behaviorPaste).toContain("inactive reader denied");
    expect(behaviorPaste).toContain(
      "values('51004000-0000-4000-8000-000000000001','51000000-0000-4000-8000-000000000006','assignment'",
    );
    expect(behaviorPaste).toContain(
      "select public.mark_all_notifications_read();\nselect pg_temp.n1_record('43 mark all clears caller unread',public.get_notification_unread_count()=0);",
    );
    expect(behaviorPaste).not.toContain(
      "public.mark_all_notifications_read()>=0 and",
    );
    expect(behaviorPaste).toContain("masked access keeps task ID with generic title");
    expect(behaviorPaste).toContain("hidden access removes task ID and all hidden titles");
    expect(behaviorPaste).toContain("three-comment burst creates exactly 45 mentions");
    expect(catalogPaste).toContain("Run without RLS");
    expect(behaviorPaste).toContain("Run without RLS");
    expect(catalogPaste).not.toMatch(/create\s+temporary\s+table/i);
    expect(behaviorPaste).not.toMatch(/create\s+temporary\s+table/i);
    expect(catalogPaste).toContain(
      "array_agg(column_name::text order by ordinal_position)",
    );
    expect(catalogPaste).toContain(
      "latest content helper blocks browser execute",
    );
    expect(behaviorPaste).toContain(
      "set_config('ceit_connect.task_access_writer','create_active_event_task',true)",
    );
    expect(behaviorPaste).toContain(
      "'Draft mention',false,array['51000000-0000-4000-8000-000000000002'::uuid]",
    );
    expect(catalogPaste).toContain("insert into auth.users");
    expect(behaviorPaste).toContain("insert into auth.users");
    expect(behaviorPaste).not.toContain("\\gset");
  });

  it("uses the latest writer signatures referenced by Paste B", () => {
    expect(draftVisibility).toContain(
      "create function public.assign_task_people(p_task_id uuid,p_primary_assignees uuid[],p_assist_assignees uuid[])",
    );
    expect(draftVisibility).toContain(
      "create function public.add_task_comment(p_task_id uuid,p_body text,p_is_heads_up boolean default false,p_mentioned_user_ids uuid[] default '{}')",
    );
    expect(draftVisibility).toContain(
      "create function public.edit_task_comment(p_comment_id uuid,p_body text,p_is_heads_up boolean,p_mentioned_user_ids uuid[],p_expected_edited_at timestamptz)",
    );
    expect(latestClaim).toContain(
      "create or replace function public.claim_task(p_task_id uuid)",
    );
    expect(backupWriter).toMatch(
      /create function public\.set_task_backup_request\(\s*p_task_id uuid,\s*p_request_backup boolean/,
    );
    expect(taskRules).toContain(
      "create function public.resolve_task_leave_request(p_request_id uuid,p_decision text)",
    );
    expect(peerAdmin).toContain(
      "create or replace function public.former_member_eligibility(p_user_id uuid)",
    );
  });

  it("does not add an event or task foreign key", () => {
    const contextTable = migration.slice(
      migration.indexOf("create table if not exists ceit_connect_private.notification_suppression_context"),
      migration.indexOf("alter table ceit_connect_private.notification_suppression_context owner"),
    );
    expect(contextTable).toContain("task_id uuid not null");
    expect(contextTable).not.toMatch(/references\s+public\.(?:events|tasks)/i);
    expect(catalogPaste).toContain("notifications_task_id_fkey");
    expect(catalogPaste).toContain("lock_order=70");
  });
});

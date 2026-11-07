import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261106150000_activity_log_subjects.sql",
  "utf8",
).replace(/\r\n/g, "\n");
const batch14VisibilityMigration = readFileSync(
  "supabase/migrations/20261109121000_batch_14_inactive_event_visibility.sql",
  "utf8",
).replace(/\r\n/g, "\n");

describe("Batch B Stage 1 migration contract", () => {
  it("defines all 39 approved semantic activity types", () => {
    const rows = migration.match(/^\s*\('[a-z_]+', '(?:INSERT|UPDATE|DELETE)',/gm);
    expect(rows).toHaveLength(39);
    expect(migration).toContain(
      "('bulk_members_removed', 'DELETE', 'bulk', 'leadership'",
    );
    expect(migration).toContain(
      "('task_deleted', 'DELETE', 'task', 'task_access'",
    );
  });

  it("keeps the public reader signature and fixed output shape", () => {
    expect(migration).toContain(
      "create or replace function public.list_activity_log(",
    );
    expect(migration).toContain(
      "uuid, text, text, uuid, date, date, text, timestamptz, uuid, integer",
    );
    for (const output of [
      "activity_id uuid",
      "activity_created_at timestamptz",
      "task_title text",
      "change_summary text[]",
      "next_cursor_id uuid",
    ]) {
      expect(migration).toContain(output);
    }
    expect(migration).toContain("limit 2001");
  });

  it("keeps global activity leadership-only and Task History task-scoped", () => {
    expect(migration).toContain(
      "if v_caller_role not in ('Admin', 'Co-Admin') then",
    );
    expect(migration).toContain(
      "and (p_task_id is null or log_row.task_id = p_task_id)",
    );
    expect(migration).toContain(
      "v_caller_role = 'Member' and not (",
    );
  });

  it("is superseded by the inactive-safe events_select mirror", () => {
    expect(migration).toContain(
      "create function ceit_connect_private.activity_event_status_visible_for_user",
    );
    expect(migration).toContain("p_event_status <> 'Draft'");
    expect(migration).not.toContain("p_event_status <> 'Draft'\n        or profile.role");
    expect(migration).toContain("profile.role in ('Admin', 'Co-Admin')");
    expect(migration).toContain(
      "ceit_connect_private.activity_event_status_visible_for_user(v_deleted_event_status, v_caller_id)",
    );
    expect(batch14VisibilityMigration).toContain(
      "create or replace function ceit_connect_private.activity_event_status_visible_for_user",
    );
    expect(batch14VisibilityMigration).toContain("and profile.is_active");
    expect(batch14VisibilityMigration).toContain("p_event_status <> 'Draft'");
    expect(batch14VisibilityMigration).toContain(
      "or profile.role in ('Admin', 'Co-Admin')",
    );
    expect(batch14VisibilityMigration).toContain(
      "an active profile is required for every status",
    );
  });

  it("enforces the approved deleted-task title exception", () => {
    expect(migration).toContain("task_was_confidential boolean");
    expect(migration).toContain("task_title_snapshot text");
    expect(migration).toContain("activity_type = 'task_deleted'");
    expect(migration).toContain("task_was_confidential is false");
    expect(migration).toContain(
      "v_caller_role in ('Admin', 'Co-Admin')",
    );
    expect(migration).toContain("then 'Deleted task'");
  });

  it("constrains the event-delete name exception and poison-prone payloads", () => {
    expect(migration).toContain(
      "('event_deleted', 'DELETE', 'event', 'leadership', 'Event deleted', array['event_status','event_name'])",
    );
    expect(migration).toContain("activity_log_event_name_snapshot_check");
    expect(migration).toContain("activity_log_event_phase_payload_check");
    expect(migration).toContain("activity_log_bulk_payload_check");
    expect(migration).toContain("activity_log_assignment_payload_check");
    expect(migration).toContain("activity_log_leave_requester_payload_check");
  });

  it("keeps masked rows fully masked and returns only live task ids", () => {
    expect(migration).not.toContain(
      "v_row_task_id := v_candidate.stored_task_id",
    );
    expect(migration).toContain(
      "v_row_task_id := v_candidate.live_task_id",
    );
    expect(migration).toContain("if not v_row_masked then\n        v_row_actor_name");
    expect(migration).toContain("'Deleted event'");
  });

  it("resolves assignment and leave names only at read time", () => {
    expect(migration).toContain("jsonb_array_elements_text(");
    expect(migration).toContain("'Former member'");
    expect(migration).toContain("v_related_count > 3");
    expect(migration).not.toContain("assignee_name_snapshot");
    expect(migration).not.toContain("requester_name_snapshot");
  });

  it("stores person audience facts instead of reading live committee state", () => {
    expect(migration).toContain("changes ? 'old_committee_id'");
    expect(migration).toContain("changes ? 'new_committee_id'");
    expect(migration).toContain("changes -> 'target_role'");
    expect(migration).toContain(
      "v_candidate.changes ->> 'old_committee_id' = p_committee_id::text",
    );
    expect(migration).not.toContain("target.committee_id");
  });

  it("reserves a non-impersonating system actor without adding a writer", () => {
    expect(migration).toContain("actor_kind in ('user', 'system', 'unavailable')");
    expect(migration).toContain(
      "actor_kind in ('system', 'unavailable') and user_id is null",
    );
    expect(migration).toContain("when v_candidate.actor_kind = 'system' then 'System'");
    expect(migration).not.toContain("insert into public.activity_log");
  });

  it("leaves raw activity access revoked", () => {
    expect(migration).toContain(
      "revoke all on table public.activity_log\nfrom public, anon, authenticated, service_role;",
    );
    expect(migration).toContain(
      "grant execute on function public.list_activity_log(",
    );
  });
});

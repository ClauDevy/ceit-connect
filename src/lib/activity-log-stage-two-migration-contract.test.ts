import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const stage2a = readFileSync(
  "supabase/migrations/20261106160000_activity_log_trigger_writers.sql",
  "utf8",
);
const stage2b = readFileSync(
  "supabase/migrations/20261106170000_activity_log_event_writers.sql",
  "utf8",
);
const eventDeleteInventoryFollowUp = readFileSync(
  "supabase/migrations/20261107120000_event_phase_delete_lock_inventory.sql",
  "utf8",
);

describe("Batch B Stage 2 migration contracts", () => {
  it("installs a private catalog-validating insert boundary", () => {
    expect(stage2a).toContain("create function ceit_connect_private.write_activity(");
    expect(stage2a).toContain("jsonb_object_keys(p_changes)");
    expect(stage2a).toContain("v_catalog.allowed_payload_keys");
    expect(stage2a).toContain("char_length(v_phase_value) not between 1 and 100");
    expect(stage2a).toContain("from public, anon, authenticated, service_role");
  });

  it("replaces legacy task snapshots with semantic rows and explicit actors", () => {
    expect(stage2a).toContain("create or replace function public.log_task_activity()");
    expect(stage2a).not.toContain("to_jsonb(old) - 'updated_at'\n    );");
    expect(stage2a).toContain("'task_assigned'");
    expect(stage2a).toContain("'task_confidentiality_changed'");
    expect(stage2a).toContain("array_append(v_changed_fields, 'assignees')");
    expect(stage2a).toContain("array_append(v_changed_fields, 'committee')");
    expect(stage2a).toContain("jsonb_build_array('other')");
    expect(stage2a).toContain("v_evidence_count > 0");
    expect(stage2a).toContain("or v_evidence_malformed");
    expect(stage2a).toContain("v_assignee_role_changed");
    expect(stage2a).toContain("v_new_comparable := v_new_comparable - 'phase'");
    expect(stage2a).not.toContain("v_new_comparable := v_new_comparable - 'committee_id'");
    expect(stage2a).not.toContain("v_new_comparable := v_new_comparable - 'event_id'");
    expect(stage2a).toContain("then 'unavailable' else 'user'");
  });

  it("adds all approved trigger-backed subject writers", () => {
    for (const trigger of [
      "task_leave_requests_z9_activity_log",
      "task_volunteers_z9_activity_log",
      "users_z9_activity_log",
      "officer_invites_z9_activity_log",
    ]) {
      expect(stage2a).toContain(`create trigger ${trigger}`);
    }
    expect(stage2a).toContain("else\n      return new;");
    const anonymization = stage2a.indexOf("v_former_writer = 'anonymize_former_member'");
    const role = stage2a.indexOf("new.role is distinct from old.role", anonymization);
    const active = stage2a.indexOf("new.is_active is distinct from old.is_active", role);
    const committee = stage2a.indexOf("new.committee_id is distinct from old.committee_id", active);
    expect(anonymization).toBeGreaterThan(-1);
    expect(anonymization).toBeLessThan(role);
    expect(role).toBeLessThan(active);
    expect(active).toBeLessThan(committee);
  });

  it("uses wrappers over the latest event boundaries", () => {
    for (const prior of [
      "create_event_with_tasks_pre_batch_b",
      "create_event_from_archived_template_pre_batch_b",
      "edit_event_with_tasks_pre_batch_b",
      "archive_event_pre_batch_b",
      "delete_event_pre_batch_b",
    ]) {
      expect(stage2b).toContain(prior);
    }
    expect(stage2b.match(/if p_status = 'Active' then/g)).toHaveLength(2);
    expect(stage2b.match(/'event_launched','user',v_actor/g)).toHaveLength(3);
    expect(stage2b).toContain("pg_catalog.left(v_name,150)");
    expect(stage2b).toContain("pg_catalog.btrim(pg_catalog.left(coalesce(v_name,''),150)) <> ''");
  });

  it("suppresses only canonical rename task phases and compares survivor ranks", () => {
    expect(stage2b).toContain("set_config('ceit_connect.activity_phase_renames',v_phase_renames::text,true)");
    expect(stage2b.match(/set_config\('ceit_connect\.activity_phase_renames','',true\)/g)).toHaveLength(2);
    expect(stage2a).toContain("pair.value ->> 'from' = public.canonical_task_phase(old.phase)");
    expect(stage2a).toContain("pair.value ->> 'to' = public.canonical_task_phase(new.phase)");
    expect(stage2b).toContain("dense_rank() over");
    expect(stage2b).toContain("v_survivor_ranks");
    expect(stage2b).toContain("'phase_renamed'");
    expect(stage2b).toContain("'phase_moved'");
  });

  it("keeps event deletion behind the dedicated executor", () => {
    expect(stage2b).toContain("event_delete_actor_is_active_admin(p_actor_id)");
    expect(stage2b).toContain("owner to ceit_event_delete_executor");
    expect(stage2b).toContain("grant execute on function public.delete_events_bulk(jsonb,uuid) to service_role");
    expect(stage2b).not.toContain("grant execute on function public.delete_event_pre_batch_b");
    const executorMembership = stage2b.indexOf("grant ceit_event_delete_executor to postgres;");
    const renamePrior = stage2b.indexOf(
      "alter function public.delete_event(uuid,uuid,timestamptz) rename to delete_event_pre_batch_b;",
    );
    expect(executorMembership).toBeGreaterThan(-1);
    expect(executorMembership).toBeLessThan(renamePrior);
    expect(stage2b.indexOf("set local role ceit_event_delete_executor;")).toBeLessThan(renamePrior);
    expect(stage2b.indexOf("reset role;", renamePrior)).toBeGreaterThan(renamePrior);
    expect(stage2b.match(/grant create on schema public to ceit_event_delete_executor;/g)).toHaveLength(2);
    expect(stage2b.match(/revoke create on schema public from ceit_event_delete_executor;/g)).toHaveLength(2);
  });

  it("writes per-event rows plus one successful-count bulk summary", () => {
    expect(stage2b).toContain("exception when others then");
    expect(stage2b).toContain("pg_catalog.cardinality(v_success_ids)");
    expect(stage2b).toContain("'bulk_events_deleted'");
  });

  it("makes the former-member finalizer authenticated, proven, and retry-idempotent", () => {
    expect(stage2b).toContain("create function public.finalize_former_member_bulk_activity");
    expect(stage2b).toContain("activity_type='person_removed'");
    expect(stage2b).toContain("if found then return v_existing");
    expect(stage2b).toContain("grant execute on function public.finalize_former_member_bulk_activity(uuid[]) to authenticated");
  });

  it("registers event phase positions in the fail-closed deletion lock inventory", () => {
    expect(eventDeleteInventoryFollowUp).toContain(
      "'event_phase_positions_event_id_fkey'",
    );
    expect(eventDeleteInventoryFollowUp).toContain("'event_child_rows'");
    expect(eventDeleteInventoryFollowUp).toContain("'event_phase_positions'");
    expect(eventDeleteInventoryFollowUp).toContain("using p_event_id;");
    expect(eventDeleteInventoryFollowUp).toContain(
      "where lock_row.lock_kind in ('task_child_rows', 'event_child_rows')",
    );
    expect(eventDeleteInventoryFollowUp).toContain(
      "revoke all on function ceit_connect_private.lock_event_delete_descendants(uuid)",
    );
    expect(eventDeleteInventoryFollowUp).not.toContain(
      "create or replace function ceit_connect_private.event_delete_actor_is_active_admin",
    );
    expect(eventDeleteInventoryFollowUp).not.toContain(
      "create or replace function public.delete_event(",
    );
  });
});

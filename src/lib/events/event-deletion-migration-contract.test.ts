import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20261031130000_event_deletion.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const normalized = sql.replace(/\s+/g, " ").toLowerCase();

describe("Batch 13d event-deletion migration contract", () => {
  it("uses the dedicated non-login executor without a users grant or GUC authority", () => {
    expect(normalized).toContain("create role ceit_event_delete_executor");
    expect(normalized).toContain("nologin noinherit nosuperuser nocreaterole nocreatedb");
    expect(normalized).toContain("noreplication nobypassrls");
    expect(normalized).toContain(
      "owner to ceit_event_delete_executor",
    );
    expect(normalized).not.toMatch(
      /grant\s+select[^;]*public\.users[^;]*ceit_event_delete_executor/,
    );
    expect(normalized).not.toContain("ceit_connect.event_delete");
    expect(normalized).not.toContain("set_config(");
  });

  it("authorizes before context and locks event, advisory key, tasks, then children", () => {
    const publicBody = normalized.slice(
      normalized.indexOf("create function public.delete_event("),
    );
    expect(publicBody.indexOf("event_delete_actor_is_active_admin")).toBeLessThan(
      publicBody.indexOf("insert into ceit_connect_private.event_delete_cascade_context"),
    );

    const helperBody = normalized.slice(
      normalized.indexOf("create function ceit_connect_private.perform_event_delete("),
      normalized.indexOf("create function public.delete_event("),
    );
    expect(helperBody.indexOf("for update;")).toBeLessThan(
      helperBody.indexOf("pg_advisory_xact_lock"),
    );
    expect(helperBody.indexOf("pg_advisory_xact_lock")).toBeLessThan(
      helperBody.indexOf("lock_event_delete_descendants"),
    );
    expect(helperBody.indexOf("lock_event_delete_descendants")).toBeLessThan(
      helperBody.indexOf("delete from public.events"),
    );
    expect(normalized).toContain("for update nowait");
  });

  it("pins every current event/task foreign key and fails closed on additions", () => {
    for (const constraint of [
      "tasks_event_id_fkey",
      "tasks_depends_on_task_id_fkey",
      "task_work_links_task_id_fkey",
      "task_volunteers_task_id_fkey",
      "task_comments_task_id_fkey",
      "archived_task_viewers_task_id_fkey",
      "notifications_task_id_fkey",
      "task_leave_requests_task_id_fkey",
    ]) {
      expect(normalized).toContain(`'${constraint}'`);
    }
    expect(normalized).toContain("pg_catalog.pg_constraint");
    expect(normalized).toContain(
      "event deletion stopped because its foreign-key lock inventory is incomplete",
    );
  });

  it("closes raw deletion and keeps the service-only RPC singular", () => {
    expect(normalized).toContain("drop policy if exists events_delete");
    expect(normalized).toContain(
      "revoke delete on table public.events from public, anon, authenticated, service_role",
    );
    expect(normalized.match(/create function public\.delete_event\(/g)).toHaveLength(1);
    expect(normalized).toContain(
      "grant execute on function public.delete_event(uuid, uuid, timestamptz) to service_role",
    );
    const revokeIndex = normalized.indexOf(
      "revoke all on function public.delete_event(uuid, uuid, timestamptz)",
    );
    const grantIndex = normalized.indexOf(
      "grant execute on function public.delete_event(uuid, uuid, timestamptz) to service_role",
    );
    const ownerMembershipIndex = normalized.indexOf(
      "grant ceit_event_delete_executor to postgres",
    );
    const schemaCreateGrantIndex = normalized.indexOf(
      "grant create on schema public to ceit_event_delete_executor",
    );
    const ownerChangeIndex = normalized.indexOf(
      "alter function public.delete_event(uuid, uuid, timestamptz) owner to ceit_event_delete_executor",
    );
    const schemaCreateRevokeIndex = normalized.indexOf(
      "revoke create on schema public from ceit_event_delete_executor",
    );
    expect(revokeIndex).toBeLessThan(ownerMembershipIndex);
    expect(grantIndex).toBeLessThan(ownerMembershipIndex);
    expect(ownerMembershipIndex).toBeLessThan(schemaCreateGrantIndex);
    expect(schemaCreateGrantIndex).toBeLessThan(ownerChangeIndex);
    expect(ownerChangeIndex).toBeLessThan(schemaCreateRevokeIndex);
    expect(normalized).toContain(
      "pg_catalog.has_schema_privilege( 'ceit_event_delete_executor', 'public', 'create' )",
    );
    expect(normalized).toContain(
      "ceit_event_delete_executor must own only delete_event",
    );
    expect(normalized).toContain("privilege.grantee = 0");
    expect(normalized).toContain("pg_catalog.aclexplode(procedure.proacl)");
    expect(normalized).toContain(
      "if pg_catalog.has_function_privilege( 'anon', 'public.delete_event(uuid,uuid,timestamptz)', 'execute' )",
    );
    expect(normalized).toContain(
      "or pg_catalog.has_function_privilege( 'authenticated', 'public.delete_event(uuid,uuid,timestamptz)', 'execute' )",
    );
    expect(normalized).toContain(
      "not pg_catalog.has_function_privilege( 'service_role', 'public.delete_event(uuid,uuid,timestamptz)', 'execute' )",
    );
  });

  it("schema-qualifies the deferred invariant under the empty search path", () => {
    expect(normalized).toContain(
      "set constraints public.tasks_preserve_active_event_task_on_delete immediate",
    );
    expect(normalized).toContain(
      "set constraints public.tasks_preserve_active_event_task_on_delete deferred",
    );
    expect(normalized).not.toMatch(
      /set constraints tasks_preserve_active_event_task_on_delete/,
    );
  });

  it("accepts only the version-appropriate postgres creator membership", () => {
    expect(normalized.match(/attribute\.attname in \('inherit_option', 'set_option'\)/g)).toHaveLength(2);
    expect(normalized.match(/pg_catalog\.to_jsonb\(membership\) ->> 'inherit_option'/g)).toHaveLength(2);
    expect(normalized.match(/pg_catalog\.to_jsonb\(membership\) ->> 'set_option'/g)).toHaveLength(2);
    expect(normalized.match(/membership\.member = 'postgres'::regrole/g)).toHaveLength(2);
    expect(normalized.match(/membership\.admin_option is true/g)).toHaveLength(2);
    expect(normalized.match(/v_membership_count <> 1 or v_valid_membership_count <> 1/g)).toHaveLength(2);
    expect(normalized.match(/v_membership_count <> 0/g)).toHaveLength(2);
  });

  it("requires the parent task to be absent for work-link and comment cascade exemptions", () => {
    for (const [start, end] of [
      [
        "create or replace function public.guard_task_work_link_writes()",
        "alter function public.guard_task_work_link_writes()",
      ],
      [
        "create or replace function public.guard_task_comment_writes()",
        "alter function public.guard_task_comment_writes()",
      ],
    ]) {
      const body = normalized.slice(
        normalized.indexOf(start),
        normalized.indexOf(end),
      );
      expect(body).toContain("pg_catalog.pg_trigger_depth()>1");
      expect(body).toContain(
        "not exists ( select 1 from public.tasks as task_row where task_row.id=old.task_id )",
      );
    }
  });

  it("retains activity UUIDs and masks every ever-confidential orphan row", () => {
    expect(normalized).toContain("drop constraint activity_log_task_id_fkey");
    expect(normalized).toContain("values ( old.id, v_actor_id, 'delete'");
    expect(normalized).toContain("v_orphan_has_confidential");
    expect(normalized).toContain("v_orphan_evidence_invalid");
    expect(normalized).toContain(
      "sibling.changes -> 'old' -> 'is_confidential' = 'true'::jsonb",
    );
  });

  it("uses private leased cleanup functions and never writes storage.objects", () => {
    expect(normalized).toContain("create table public.event_storage_cleanup_jobs");
    expect(normalized).toContain("interval '5 minutes'");
    expect(normalized).toContain("for update of job skip locked");
    expect(normalized).toContain(
      "job.status = 'failed' and job.last_attempt_at <= v_now - interval '1 minute'",
    );
    expect(normalized).toContain(
      "order by job.last_attempt_at nulls first, job.created_at, job.id",
    );
    expect(normalized).toContain("job.claim_token = p_claim_token");
    expect(normalized).toContain("job.lease_expires_at > v_now");
    expect(normalized).not.toMatch(/delete\s+from\s+storage\.objects/);
  });

  it("keeps repository-wide migration syntax restrictions", () => {
    expect(sql).not.toMatch(/pg_catalog\.coalesce\s*\(/i);
    expect(sql).not.toMatch(/\bif\s+case\b/i);
  });
});

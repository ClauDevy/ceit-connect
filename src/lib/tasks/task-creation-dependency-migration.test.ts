import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/20261130120000_task_creation_dependencies.sql"), "utf8");

describe("task creation dependency migration contract", () => {
  it("is additive and does not add an event or task foreign key", () => {
    expect(sql).not.toMatch(/create or replace function|alter table public\.(events|tasks)\s+add constraint/i);
    expect(sql).toContain("create_event_with_task_dependencies");
    expect(sql).toContain("edit_event_with_task_dependencies");
    expect(sql).toContain("create_active_event_task_with_dependency");
  });

  it("delegates to the latest public writers and preserves the validator", () => {
    expect(sql).toContain("public.create_event_with_tasks(");
    expect(sql).toContain("public.edit_event_with_tasks(");
    expect(sql).toContain("public.create_active_event_task(");
    expect(sql).toContain("before insert on public.tasks");
    expect(sql).toContain("new.depends_on_task_id := v_dependency");
  });

  it("preserves original Create Event phase order after ordering dependency inserts", () => {
    const createWrapper = sql.slice(
      sql.indexOf("create function public.create_event_with_task_dependencies("),
      sql.indexOf("alter function public.create_event_with_task_dependencies("),
    );
    expect(createWrapper).toContain(
      "array_agg(phase_key order by first_ordinality)",
    );
    expect(createWrapper).toContain(
      "group by public.canonical_task_phase(value ->> 'phase')",
    );
    const eventLock = createWrapper.indexOf(
      "perform 1 from public.events where id = v_event for update;",
    );
    const dependencyLock = createWrapper.indexOf(
      "pg_advisory_xact_lock(public.task_dependency_lock_key(v_event))",
    );
    const reconcile = createWrapper.indexOf(
      "reconcile_event_phase_positions(v_event, v_phase_order)",
    );
    expect(eventLock).toBeGreaterThan(-1);
    expect(dependencyLock).toBeGreaterThan(eventLock);
    expect(reconcile).toBeGreaterThan(dependencyLock);
  });

  it("documents creation-only activity behavior", () => {
    expect(sql).toContain("no separate Dependency updated activity row is emitted");
  });

  it("fails closed for unavailable prerequisites and hides masked dependency ids", () => {
    expect(sql).toContain(
      "coalesce(public.task_content_access(v_saved_dependency), 'hidden') not in ('real', 'masked')",
    );
    expect(sql).toContain(
      "case when public.task_content_access(t.id) = 'real' then t.depends_on_task_id else null end",
    );
  });

  it("normalizes temporary UUID spellings before both map lookups", () => {
    expect(sql).toContain(
      "v_map ->> ((v_item ->> 'depends_on_client_key')::uuid)::text",
    );
    expect(sql).toContain(
      "v_map->>(((v_item->>'depends_on_client_key')::uuid)::text)",
    );
  });

  it("clears every transaction-local plan setting on success and every wrapper failure", () => {
    const clearBody = sql.slice(
      sql.indexOf("create function ceit_connect_private.clear_task_creation_dependency_context()"),
      sql.indexOf("create function ceit_connect_private.finish_task_creation_dependencies()"),
    );
    for (const setting of [
      "ceit_connect.task_creation_dependency_plan",
      "ceit_connect.task_creation_dependency_index",
      "ceit_connect.task_creation_dependency_map",
    ]) {
      expect(clearBody).toContain(`set_config('${setting}', '', true)`);
    }
    expect(sql.match(/perform ceit_connect_private\.finish_task_creation_dependencies\(\);/g)).toHaveLength(3);
    expect(sql.match(/exception when others then\s+perform ceit_connect_private\.clear_task_creation_dependency_context\(\);/g)).toHaveLength(3);
    expect(sql).toContain("current_user is postgres, so the current_user trigger guard is always true");
  });
});

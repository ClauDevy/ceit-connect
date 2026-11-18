import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const oldGuardMigration = readFileSync(
  "supabase/migrations/20261031120000_template_import_all_committees.sql",
  "utf8",
).replaceAll("\r\n", "\n");
const rawMigration = readFileSync(
  "supabase/migrations/20261123120000_task_editor_self_assignment.sql",
  "utf8",
);
const migration = rawMigration.replaceAll("\r\n", "\n");
const batchDoc = readFileSync(
  "docs/phase-5/step-c-task-editor-self-assignment.md",
  "utf8",
).replaceAll("\r\n", "\n");
const writerSources = [
  "supabase/migrations/20261106170000_activity_log_event_writers.sql",
  "supabase/migrations/20261106120000_event_phase_positions.sql",
  "supabase/migrations/20261031140000_completed_phase_freeze.sql",
  "supabase/migrations/20261121120000_active_task_date_guard.sql",
]
  .map((path) => readFileSync(path, "utf8").replaceAll("\r\n", "\n"))
  .join("\n");

function guardBody(source: string) {
  const start = source.indexOf(
    "create or replace function public.guard_task_assignee_writes()",
  );
  const end = source.indexOf(
    "alter function public.guard_task_assignee_writes() owner to postgres;",
    start,
  );
  return source.slice(start, end);
}

describe("Batch C task-editor self-assignment migration contract", () => {
  it("is later than Step B and uses LF, dollar quoting, and no session identity", () => {
    expect(20261123120000).toBeGreaterThan(20261122120000);
    expect(rawMigration).not.toContain("\r");
    expect(migration).not.toMatch(/\bE'/);
    expect(migration).not.toContain("session_user");
  });

  it("keeps the helper read-only, postgres-only, marker-exact, and ungranted", () => {
    expect(migration).toContain("stable\nsecurity invoker\nset search_path = ''");
    expect(migration).toContain("if current_user <> 'postgres'");
    for (const writer of [
      "create_event_with_tasks",
      "create_event_from_archived_template",
      "edit_event_with_tasks",
      "create_active_event_task",
      "edit_active_event_task",
    ]) {
      expect(migration).toContain(`'${writer}'`);
    }
    expect(migration).toContain("profile.is_active is true");
    expect(migration).toContain("profile.role in ('Admin', 'Co-Admin')");
    expect(migration).toContain("p_operation = 'INSERT'");
    expect(migration).toContain(
      "v_committee_id is not distinct from p_old_committee_id",
    );
    expect(migration).toContain(
      "v_committee_id is not distinct from p_new_committee_id",
    );
    expect(migration).toMatch(
      /revoke all on function public\.task_editor_self_assignment_allowed\([\s\S]*?from public, anon, authenticated, service_role;/,
    );
    expect(migration).not.toMatch(
      /grant execute on function public\.task_editor_self_assignment_allowed/,
    );
    const helper = migration.slice(
      migration.indexOf("create function public.task_editor_self_assignment_allowed"),
      migration.indexOf("alter function public.task_editor_self_assignment_allowed"),
    );
    expect(helper).not.toMatch(
      /\n\s*(?:insert\s+into|update\s+public\.|delete\s+from|perform[\s\S]*?\block|perform[\s\S]*?set_config)\b/i,
    );
  });

  it("keeps the 20261031120000 guard plus only the approved predicate", () => {
    const oldBody = guardBody(oldGuardMigration);
    const newBody = guardBody(migration);
    const helperPredicate = /\n     and not public\.task_editor_self_assignment_allowed\([\s\S]*?\n     \) then/;
    expect(newBody).toMatch(helperPredicate);
    expect(newBody.replace(helperPredicate, " then")).toBe(oldBody);
  });

  it("keeps untrusted writes ahead of the helper and preserves CCP01 exceptions", () => {
    const body = guardBody(migration);
    const untrusted = body.indexOf("and not v_trusted then");
    const helper = body.indexOf("task_editor_self_assignment_allowed");
    expect(untrusted).toBeGreaterThan(-1);
    expect(helper).toBeGreaterThan(untrusted);
    expect(body).toContain("and coalesce(v_writer, '') <> 'claim_task'");
    expect(body).toContain(
      "and coalesce(v_self_writer, '') <> 'volunteer_for_task'",
    );
    expect(body).toContain("errcode = 'CCP01'");
    expect(body).toContain(
      "message = 'The selected person is already covered by this task.'",
    );
  });

  it("does not add another acting-user rejection to the five latest writers", () => {
    const templateWriterSource = oldGuardMigration.slice(
      oldGuardMigration.indexOf("create function public.copy_archived_template_tasks"),
    );
    expect(`${writerSources}\n${templateWriterSource}`).not.toContain(
      "The acting user cannot be newly selected.",
    );
  });

  it("pins the one-paste rollback report and actor-notification check", () => {
    const sql = batchDoc.slice(
      batchDoc.indexOf("```sql\n") + "```sql\n".length,
      batchDoc.lastIndexOf("\n```"),
    );
    expect(sql.split("\n")).toHaveLength(448);
    expect(
      sql.match(/insert into batch_c_results\(label, passed(?:, detail)?\)/g),
    ).toHaveLength(17);
    expect(sql).toContain(
      "'Self-selection sends no assignment notification to actor'",
    );
    expect(sql).toContain(
      "'Raw authenticated write keeps its existing task_volunteers denial'",
    );
    expect(sql).toContain(
      "raise exception 'TEST RESULTS %/% PASS; FAILED: % (intentional rollback)'",
    );
    expect(sql.trimEnd().endsWith("rollback;")).toBe(true);
  });
});

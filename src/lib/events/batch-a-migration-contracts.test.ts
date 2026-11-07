import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = join(process.cwd(), "supabase", "migrations");
const phaseMigration = readFileSync(
  join(migrationsDirectory, "20261106120000_event_phase_positions.sql"),
  "utf8",
).toLowerCase();
const deadlineMigration = readFileSync(
  join(migrationsDirectory, "20261106140000_event_deadline_bounds.sql"),
  "utf8",
).toLowerCase();
const adminMigration = readFileSync(
  join(migrationsDirectory, "20261106130000_peer_admin_lifecycle.sql"),
  "utf8",
).toLowerCase();
const sqlPastes = readFileSync(
  join(process.cwd(), "docs", "phase-4b", "step-a-tests.md"),
  "utf8",
).toLowerCase();

function functionBody(source: string, signature: string, nextMarker: string) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Batch A migration review contracts", () => {
  it("quotes position whenever it is a RETURNS TABLE output column", () => {
    expect(phaseMigration).toContain(
      'returns table (phase_key text, "position" bigint)',
    );

    for (const migration of [phaseMigration, adminMigration, deadlineMigration]) {
      const returnTables = migration.matchAll(
        /returns\s+table\s*\(([\s\S]*?)\)\s*(?:language|as)/g,
      );
      for (const returnTable of returnTables) {
        expect(returnTable[1]).not.toMatch(/(?:^|,)\s*position\s+[a-z]/m);
      }
    }
  });

  it("uses a compatible share lock for deferred phase reconciliation", () => {
    const body = functionBody(
      phaseMigration,
      "create function ceit_connect_private.defer_event_phase_reconciliation()",
      "alter function ceit_connect_private.defer_event_phase_reconciliation()",
    );
    expect(body).toContain("for share");
    expect(body).not.toContain("for update");
    expect(body.indexOf("for share")).toBeLessThan(
      body.indexOf("pg_catalog.pg_advisory_xact_lock"),
    );
  });

  it("schema-qualifies the deferred phase-position constraint", () => {
    expect(phaseMigration).toContain(
      "set constraints ceit_connect_private.event_phase_positions_event_position_key deferred",
    );
    expect(phaseMigration).not.toMatch(
      /set constraints\s+event_phase_positions_event_position_key\s+deferred/,
    );
  });

  it("exposes Archived phase order only through real task access", () => {
    const body = functionBody(
      phaseMigration,
      "create function public.list_event_phase_order(p_event_id uuid)",
      "alter function public.list_event_phase_order(uuid)",
    );
    expect(body).toContain("caller.id = auth.uid() and caller.is_active");
    expect(body).toContain("event_row.status = 'archived'");
    expect(body).toContain(
      "public.task_content_access_for_user(task_row.id, auth.uid()) = 'real'",
    );
    expect(body).toContain(
      "event_row.status = 'draft' and caller.role in ('admin','co-admin')",
    );
  });

  it("delegates typeless phase actions and reconciles task deletes", () => {
    expect(phaseMigration).toContain(
      "where value->>'type' is distinct from 'reorder'",
    );
    expect(phaseMigration).toMatch(
      /create constraint trigger tasks_z9_reconcile_event_phase_positions\s+after insert or delete or update of event_id, phase/,
    );
  });

  it("assigns due-date bounds to CCD05 without changing sibling codes", () => {
    const body = functionBody(
      deadlineMigration,
      "create function ceit_connect_private.guard_task_event_end()",
      "alter function ceit_connect_private.guard_task_event_end()",
    );
    expect(body).toContain("errcode='ccd05',message='due_date is after");
    expect(body).toContain("errcode='ccd02',message='call_time is after");
    expect(body).toContain("errcode='ccd03',message='end_time is after");
    expect(body).not.toContain("errcode='ccd01'");
  });

  it("scopes and clears the proposed event-end override", () => {
    const wrapper = functionBody(
      phaseMigration,
      "create function public.edit_event_with_tasks(",
      "alter function public.edit_event_with_tasks(",
    );
    expect(wrapper).toContain("ceit_connect.event_end_override_writer");
    expect(wrapper).toContain("ceit_connect.event_end_override_event_id");
    expect(wrapper).toContain("ceit_connect.event_end_override_is_set");
    expect(wrapper).toContain("ceit_connect.event_end_override_value");
    expect(wrapper.match(/event_end_override_writer','',true/g)).toHaveLength(2);

    const guard = functionBody(
      deadlineMigration,
      "create function ceit_connect_private.guard_task_event_end()",
      "alter function ceit_connect_private.guard_task_event_end()",
    );
    expect(guard).toContain("current_user='postgres'");
    expect(guard).toContain("event_end_override_event_id");
    expect(guard).toContain("event_end_override_is_set");
  });

  it("keeps every SQL paste result executable instead of placeholder PASS lines", () => {
    expect(sqlPastes).not.toContain("fixture/result line pass");
    expect(sqlPastes).not.toMatch(/for\s+i\s+in\s+\d+\.\.\d+/);
    expect(sqlPastes).toContain("20/20 pass");
    expect(sqlPastes).toContain("16/16 pass");
    expect(sqlPastes).toContain("24/24 pass");
  });

  it("keeps SQL paste fixtures writable and builds Archives through the writer", () => {
    expect(
      sqlPastes.match(
        /grant select,insert on batch_a_results to authenticated;/g,
      ),
    ).toHaveLength(3);
    expect(
      sqlPastes.match(
        /grant usage,select on sequence batch_a_results_seq_seq to authenticated;/g,
      ),
    ).toHaveLength(3);
    expect(sqlPastes).toContain("select public.archive_event(");
    expect(sqlPastes).toContain(
      "$pattern$event_end_override_writer','',true$pattern$",
    );
  });

  it("uses executable public writer contracts in every SQL paste", () => {
    expect(sqlPastes).not.toContain(
      "from public.former_member_eligibility(current_setting('ba.peer')::uuid)",
    );
    expect(sqlPastes).toContain(
      "from public.preview_former_member_removal(array[current_setting('ba.peer')::uuid])",
    );
    expect(sqlPastes).toContain("'phase','middle'");
    expect(sqlPastes).toContain("'phase','bee'");
    expect(sqlPastes).not.toContain(
      "and public.canonical_task_phase(task_row.phase)='b'",
    );
    expect(sqlPastes).toContain(
      "batch a admin checks failed: expected 16 rows, got %; failed: %",
    );
    expect(sqlPastes).toContain("do $anonymize$");
    expect(sqlPastes).toContain(
      "select result.out_outcome into v_outcome from public.anonymize_former_member",
    );
    expect(sqlPastes).not.toContain(
      "from public.anonymize_former_member(current_setting('ba.peer')::uuid) result join public.users",
    );
    expect(sqlPastes).toContain("set constraints all immediate;");
    expect(sqlPastes).toContain(
      "alter table public.tasks enable trigger tasks_i0_guard_event_end;",
    );
    expect(sqlPastes.indexOf("set constraints all immediate;")).toBeLessThan(
      sqlPastes.indexOf(
        "alter table public.tasks enable trigger tasks_i0_guard_event_end;",
      ),
    );
  });
});

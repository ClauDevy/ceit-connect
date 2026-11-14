import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const activeWriterOriginal = readFileSync(
  "supabase/migrations/20261028130000_active_event_task_writers.sql",
  "utf8",
).replaceAll("\r\n", "\n");
const activeDateGuard = readFileSync(
  "supabase/migrations/20261121120000_active_task_date_guard.sql",
  "utf8",
).replaceAll("\r\n", "\n");
const templateOriginal = readFileSync(
  "supabase/migrations/20261031120000_template_import_all_committees.sql",
  "utf8",
).replaceAll("\r\n", "\n");
const templateReset = readFileSync(
  "supabase/migrations/20261121130000_template_import_foreign_date_reset.sql",
  "utf8",
).replaceAll("\r\n", "\n");

const createFloorChecks = `
  if p_due_date is not null
     and (p_due_date at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD07',
      message = 'Choose today or a later due date.';
  end if;

  if p_call_time is not null
     and (p_call_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD08',
      message = 'Choose today or a later duty date.';
  end if;

  if p_end_time is not null
     and (p_end_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD09',
      message = 'Choose today or a later end date.';
  end if;
`;

const editFloorChecks = `
  if p_due_date is not null
     and (p_due_date at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_due_date at time zone 'Asia/Manila')::date
       is distinct from (v_stored_due_date at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD07',
      message = 'Choose today or a later due date.';
  end if;

  if p_call_time is not null
     and (p_call_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_call_time at time zone 'Asia/Manila')::date
       is distinct from (v_stored_call_time at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD08',
      message = 'Choose today or a later duty date.';
  end if;

  if p_end_time is not null
     and (p_end_time at time zone 'Asia/Manila')::date
       < (statement_timestamp() at time zone 'Asia/Manila')::date
     and (p_end_time at time zone 'Asia/Manila')::date
       is distinct from (v_stored_end_time at time zone 'Asia/Manila')::date then
    raise exception using errcode = 'CCD09',
      message = 'Choose today or a later end date.';
  end if;
`;

function functionBody(source: string, name: string) {
  const plain = source.indexOf(`create function public.${name}(`);
  const replacement = source.indexOf(`create or replace function public.${name}(`);
  const start = Math.max(plain, replacement);
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("as $$\n", start) + "as $$\n".length;
  const bodyEnd = source.indexOf("\n$$;", bodyStart);
  expect(bodyStart).toBeGreaterThan("as $$\n".length - 1);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

function filesUnder(path: string): string[] {
  return readdirSync(path).flatMap((entry) => {
    const child = join(path, entry);
    return statSync(child).isDirectory() ? filesUnder(child) : [child];
  });
}

describe("V1 active-task date-guard migration contract", () => {
  it.each([
    ["create_active_event_task", "create_active_event_task_step12", createFloorChecks],
    ["edit_active_event_task", "edit_active_event_task_step12", editFloorChecks],
  ])("keeps %s equal to the latest renamed original plus only its floor checks", (oldName, newName, added) => {
    const oldBody = functionBody(activeWriterOriginal, oldName);
    const newBody = functionBody(activeDateGuard, newName);
    expect(newBody.split(added)).toHaveLength(2);
    expect(newBody.replace(added, "")).toBe(oldBody);
  });

  it("places the Edit checks after the locked row and stale-token check", () => {
    const body = functionBody(activeDateGuard, "edit_active_event_task_step12");
    expect(body.indexOf("for update;")).toBeLessThan(body.indexOf("errcode = 'CCS01'"));
    expect(body.indexOf("errcode = 'CCS01'")).toBeLessThan(body.indexOf(editFloorChecks));
    expect(body.lastIndexOf("public.task_content_access(p_task_id)")).toBeLessThan(
      body.indexOf(editFloorChecks),
    );
    expect(body.indexOf(editFloorChecks)).toBeLessThan(body.indexOf("select 1 from public.committees"));
  });

  it("keeps both internal functions unreachable except through their public wrappers", () => {
    const files = [...filesUnder("supabase/migrations"), ...filesUnder("src")]
      .filter((file) => /\.(sql|ts|tsx)$/.test(file));
    const allSource = files.map((file) => readFileSync(file, "utf8")).join("\n");
    expect(
      allSource.match(
        /return query select \* from public\.create_active_event_task_step12\(/g,
      ),
    ).toHaveLength(1);
    expect(
      allSource.match(
        /return query select \* from public\.edit_active_event_task_step12\(/g,
      ),
    ).toHaveLength(1);
    expect(activeDateGuard).toContain(
      "from public, anon, authenticated, service_role;",
    );
  });

  it("pins tasks.due_date as timestamptz", () => {
    const taskSchema = readFileSync(
      "supabase/migrations/20260926051331_events_and_tasks.sql",
      "utf8",
    );
    expect(taskSchema).toMatch(/\bdue_date timestamptz\b/);
  });
});

describe("V1 foreign template schedule reset migration contract", () => {
  it("changes only the three shifted schedule expressions and their dead shift state", () => {
    const oldBody = functionBody(templateOriginal, "copy_archived_template_tasks");
    const expected = oldBody
      .replace("  v_shift_days integer;\n", "")
      .replace(
        "  v_shift_days := p_new_start_date - v_template_start_date;\n\n",
        "",
      )
      .replace(
        `    case
      when source_task.due_date is null then null
      else source_task.due_date + (v_shift_days * interval '1 day')
    end,`,
        "    null::timestamptz,",
      )
      .replace(
        `    case
      when source_task.call_time is null then null
      else source_task.call_time + (v_shift_days * interval '1 day')
    end,`,
        "    null::timestamptz,",
      )
      .replace(
        `    case
      when source_task.end_time is null then null
      else source_task.end_time + (v_shift_days * interval '1 day')
    end,`,
        "    null::timestamptz,",
      );
    expect(functionBody(templateReset, "copy_archived_template_tasks")).toBe(expected);
  });

  it("keeps the signature, copied count, return value, and internal-only grants", () => {
    expect(templateReset).toContain("p_new_start_date date");
    expect(templateReset).toContain("get diagnostics v_copied_count = row_count;");
    expect(templateReset).toContain("return v_copied_count;");
    expect(templateReset.match(/null::timestamptz/g)).toHaveLength(3);
    expect(templateReset).toContain(
      "from public, anon, authenticated, service_role;",
    );
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./event-form.tsx", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");

describe("Event form Archived-template authority contract", () => {
  it("keeps Admin and scratch creation on the existing RPC", () => {
    expect(source).toContain('supabase.rpc("create_event_with_tasks"');
    expect(source).toContain('role === "Co-Admin"');
    expect(source).toContain("shouldUseCoAdminTemplateCreate");
    expect(source).not.toMatch(
      /coAdminTemplateSummary\s*=\s*[\s\S]{0,250}templateMode/,
    );
  });

  it("sends only editable rows plus opaque exclusions to the Co-Admin RPC", () => {
    expect(source).toContain(
      'supabase.rpc("create_event_from_archived_template"',
    );
    expect(source).toContain(
      ".filter(({ task }) => task.templateEditable)",
    );
    expect(source).toContain(
      "p_excluded_template_task_ids: normalizedExclusions",
    );
    expect(source).not.toMatch(
      /p_excluded_template_task_ids:\s*tasks\.map/,
    );
  });

  it("does not offer Edit for server-derived rows but keeps Remove", () => {
    expect(source).toContain("task.templateEditable ? (");
    expect(source).toContain("sourceTemplateTaskId");
    expect(source).toContain("setExcludedTemplateTaskIds");
    expect(source).toContain("removeTask(phase.id, task.id)");
  });

  it("blocks a stale date shift until the template is re-imported", () => {
    expect(source).toContain("if (importedStartDateChanged)");
    expect(source).toContain(
      "Re-import the template after changing the event start date.",
    );
  });

  it("does not apply the same-day clock minimum to a later end date", () => {
    expect(source).toContain(
      "taskEditor.draft.endDate === taskEditor.draft.callDate",
    );
  });

  it("validates schedules only when a task draft is explicitly applied", () => {
    const taskApplyBody = source.slice(
      source.indexOf("function saveTask()"),
      source.indexOf("function removeTask("),
    );
    const eventSaveStart = source.indexOf("async function handleSave(");
    const eventSaveBody = source.slice(
      eventSaveStart,
      source.indexOf("\n  return (", eventSaveStart),
    );

    expect(taskApplyBody).toContain("getLiveOperationScheduleProblem");
    expect(eventSaveBody).not.toContain("getLiveOperationScheduleProblem");
  });

  it("keeps imported rows and the applied-template banner visible on Scratch", () => {
    expect(source).toContain("function selectTemplateMode");
    expect(source).not.toMatch(
      /function selectTemplateMode[\s\S]{0,250}(?:setPhases|setTemplateSummary|setExcludedTemplateTaskIds)/,
    );
    expect(source).toMatch(
      /\{templateMode === "archive"[\s\S]*?<MotionPresence open=\{templateSummary !== null\}>/,
    );
  });
});

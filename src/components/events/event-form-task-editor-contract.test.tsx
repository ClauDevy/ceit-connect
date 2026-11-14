import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = [
  "event-form.tsx",
  "event-form-task-dialog.tsx",
  "event-form-assignee-picker.tsx",
]
  .map((file) => readFileSync(`src/components/events/${file}`, "utf8"))
  .join("\n")
  .replaceAll("\r\n", "\n");

describe("Event form task-editor parity contract", () => {
  it("keeps type changes non-destructive and hides Due date for Live Operations", () => {
    expect(source).toContain("updateTaskDraft({ taskType: value })");
    expect(source).toContain('taskEditor.draft.taskType === "Deliverable" ? (');
    expect(source).not.toContain("Philippine duty date");
  });

  it("uses the shared wording and only genuine optional hints", () => {
    expect(source).toContain("Set the task details, schedule, and assignees.");
    expect(source).toContain('title="Schedule"');
    expect(source).toContain('title="People"');
    expect(source).toContain('label="Task type"');
    expect(source).toContain("A Live Operation schedule is optional.");
    expect(source).not.toContain('label="Duty date" hint="Optional"');
    expect(source).not.toContain('label="Call time" hint="Optional"');
  });

  it("keeps Admin committee validation field-level", () => {
    expect(source).toContain('revealTaskProblem("committee", "Choose an available committee.")');
    expect(source).toContain('error={taskEditorErrorField === "committee" ? taskEditorError : null}');
  });

  it("uses status-aware Backlog wording", () => {
    expect(source).toContain('editedTaskStatus === "In Progress"');
    expect(source).toContain("Removing all Primary assignees returns this task to To Do in the Backlog.");
    expect(source).toContain("Leave Primary assignees empty to add this task to the Backlog.");
  });
});

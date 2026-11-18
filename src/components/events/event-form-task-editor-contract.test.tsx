import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { filterEventAssigneesBySearch } from "@/lib/events/form";

const source = [
  "event-form.tsx",
  "event-form-task-dialog.tsx",
  "event-form-assignee-picker.tsx",
]
  .map((file) => readFileSync(`src/components/events/${file}`, "utf8"))
  .join("\n")
  .replaceAll("\r\n", "\n");
const producerSource = [
  "src/app/(dashboard)/events/new/page.tsx",
  "src/app/(dashboard)/events/[eventId]/edit/page.tsx",
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n")
  .replaceAll("\r\n", "\n");
const workloadReaderSource = readFileSync(
  "supabase/migrations/20261022120000_task_claim_backup_volunteers.sql",
  "utf8",
).replaceAll("\r\n", "\n");

describe("Event form task-editor parity contract", () => {
  it("keeps every active candidate available to the Event assignee picker", () => {
    expect(source).toContain(
      "const filtered = filterEventAssigneesBySearch(\n      assignees,\n      assigneeSearch,\n      committeeNames,\n    )",
    );
    expect(source).not.toContain("assignee.id !== currentUserId");
  });

  it("loads the acting Admin or Co-Admin from the active-user producer", () => {
    expect(
      producerSource.match(
        /getActiveProfileForRoles\(\[\s*"Admin",\s*"Co-Admin",?\s*\]\)/g,
      ),
    ).toHaveLength(2);
    expect(
      producerSource.match(
        /supabase\.rpc\("list_active_task_assignees_with_workload"\)/g,
      ),
    ).toHaveLength(2);
    expect(workloadReaderSource).toContain("where user_row.is_active is true");
    expect(workloadReaderSource).not.toContain("user_row.id <> auth.uid()");
  });

  it.each([
    ["Admin", "admin", "avery admin"],
    ["Co-Admin", "coadmin", "casey co-admin"],
  ])("lets an eligible %s find themselves by name", (role, actorId, search) => {
    const candidates = [
      {
        id: "admin",
        role: "Admin",
        full_name: "Avery Admin",
        committee_id: null,
      },
      {
        id: "coadmin",
        role: "Co-Admin",
        full_name: "Casey Co-Admin",
        committee_id: "committee-a",
      },
    ];

    expect(
      filterEventAssigneesBySearch(
        candidates,
        search,
        new Map([["committee-a", "Committee A"]]),
      ),
    ).toContainEqual(expect.objectContaining({ id: actorId, role }));
  });

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

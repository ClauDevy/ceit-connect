import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialog = readFileSync(
  "src/components/tasks/active-task-dialog.tsx",
  "utf8",
);
const board = readFileSync("src/components/events/event-board.tsx", "utf8");
const card = readFileSync(
  "src/components/events/event-board-task-card.tsx",
  "utf8",
);
const detail = readFileSync("src/components/tasks/task-detail.tsx", "utf8");
const taskPeopleControls = readFileSync(
  "src/components/tasks/task-people-controls.tsx",
  "utf8",
);
const activeTaskUi = readFileSync("src/lib/tasks/active-task-ui.ts", "utf8");

describe("Batch 11 active task UI contract", () => {
  it("prefills only from restricted readers and the standalone stored-priority reader", () => {
    expect(dialog).toContain('supabase.rpc("get_task_detail"');
    expect(dialog).toContain('supabase.rpc("get_task_edit_controls"');
    expect(dialog).toContain('supabase.rpc("get_task_stored_priority"');
    expect(dialog).toContain('"list_active_task_assignees_with_workload"');
    expect(dialog).not.toContain('.from("tasks")');
    expect(dialog).not.toContain("effective_priority");
    expect(dialog).toContain("storedPriority === null");
  });

  it("shares Add and Edit without exposing a Status field and reuses PriorityBadge", () => {
    expect(dialog).toContain('mode: "add" | "edit"');
    expect(dialog).not.toMatch(/<FormField label="Status"/);
    expect(dialog).toContain("<PriorityBadge");
    expect(board).toContain("Add Task");
    expect(card).toContain("Edit task");
  });

  it("settles safely, prevents duplicate submits, and refetches authoritative state", () => {
    expect(dialog).toContain("if (busy || loading) return");
    expect(dialog).toContain("await response.json().catch(() => null)");
    expect(dialog).toMatch(
      /if \(mode === "add"\) \{[\s\S]*?if \(!background\) \{\s*setDraft\(/,
    );
    expect(dialog).toContain("try {");
    expect(dialog).toContain("} catch (saveError) {");
    expect(dialog).toContain("} finally {");
    expect(dialog).toContain("Promise.allSettled([onSettled(), load(true)])");
    expect(dialog).toContain("setBusy(false)");
    expect(dialog).toContain("shouldApplyActiveTaskLoadResult(mode, background)");
    expect(dialog.indexOf("shouldApplyActiveTaskLoadResult(mode, background)")).toBeLessThan(
      dialog.indexOf("setExpectedUpdatedAt(detailResult.data[0].updated_at)"),
    );
    expect(board).toContain("refetchBoardAfterTaskSettlement");
    expect(detail).toContain("onSettled={refreshAccess}");
  });

  it("keeps failed option loads unavailable until a successful foreground reload", () => {
    expect(dialog).toContain("setOptionsLoaded(false)");
    expect(dialog).toContain("Reload task editor");
    expect(dialog).toContain("onClick={() => void load(false)}");
    expect(dialog).toMatch(/const ready =\s*!loading &&\s*optionsLoaded &&/);
    expect(dialog).toContain('disabled={!ready || busy}');
    expect(dialog.match(/setOptionsLoaded\(true\)/g)).toHaveLength(2);
  });

  it("scrolls to and focuses the first client-invalid title, committee, schedule, or people control", () => {
    expect(dialog).toContain("focusActiveTaskValidationField(validation.field)");
    expect(dialog).toContain('scrollIntoView({ block: "center" })');
    expect(dialog).toContain("control.focus()");
    expect(dialog).toContain('data-active-task-field="title"');
    expect(dialog).toContain('data-active-task-field="committee"');
    expect(dialog).toContain('data-active-task-field="schedule"');
    expect(dialog).toContain('fieldName="primaryAssignees"');
    expect(dialog).toContain('fieldName="allowedViewers"');
    expect(dialog.match(/focusActiveTaskValidationField\(/g)).toHaveLength(2);
    expect(dialog).toMatch(
      /if \(!validation\.ok\) \{\s*setError\(validation\.message\);\s*focusActiveTaskValidationField\(validation\.field\);/,
    );
  });

  it("uses supplied committee labels, filters redundant viewers, and keeps the people footer reachable", () => {
    expect(dialog).toContain("items={committeeItems}");
    expect(dialog).toContain("!draft.primaryAssigneeIds.includes(person.id)");
    expect(dialog).toContain("!assistIds.has(person.id)");
    expect(dialog).toContain("Select all shown in {bulkCommittee.name}");
    expect(dialog).toContain("Clear shown");
    expect(activeTaskUi).toContain('return "Select up to 100 people."');
    expect(taskPeopleControls).toContain(
      "grid-rows-[auto_minmax(0,1fr)_auto]",
    );
  });

  it("keeps zero-match bulk selection inert and clears only derived picker-limit state", () => {
    expect(dialog).toContain("if (bulkIds.length === 0) return");
    expect(dialog).toContain("onLimitError(attempt.attemptedCount)");
    expect(dialog).not.toContain('onLimitError={() => setError("Select up to 100 people.")}');
    expect(dialog).toMatch(
      /function clearPickerLimitAttempt\(\) \{\s*setPickerLimitAttempt\(/,
    );
    expect(dialog).toContain("if (!next) clearPickerLimitAttempt()");
    expect(dialog).toContain("clearPickerLimitAttempt(); updateDraft({ committeeId:");
    expect(dialog).toContain("clearPickerLimitAttempt(); setAssigneeSearch(value)");
    expect(dialog).toContain("clearPickerLimitAttempt(); setViewerSearch(value)");
    expect(activeTaskUi).toContain("attempt.attemptedCount > 100");
    expect(activeTaskUi).toContain("attempt.attemptedCount > 50");
  });

  it("uses shared motion in normal mode and explicit reduced-motion rows", () => {
    expect(dialog).toContain("SectionEnter");
    expect(dialog).toContain("MotionPresence");
    expect(dialog).toContain("motion-reduce:");
    expect(card).toContain("motion-reduce:");
  });

  it("keeps phone targets and hover, focus-visible, and pressed states", () => {
    expect(dialog).toContain("h-11");
    expect(dialog).toContain("hover:");
    expect(dialog).toContain("focus-visible:");
    expect(dialog).toContain("active:");
    expect(card).toContain("size-11");
    expect(dialog).not.toMatch(/#[0-9a-f]{3,8}/i);
  });

  it("places Last updated directly after Created and only opens Edit from capability state", () => {
    expect(detail.indexOf('label="Last updated"')).toBeGreaterThan(
      detail.indexOf('label="Created"'),
    );
    expect(detail).toContain("formatTaskMetadataTimestamp(task.created_at!)");
    expect(detail).toContain("formatTaskMetadataTimestamp(task.updated_at!)");
    expect(detail).toContain("canShowTaskPageEdit(");
  });
});

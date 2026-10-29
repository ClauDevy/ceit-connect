import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { BoardTask } from "../events/board";
import {
  editActiveTaskRpcArgs,
  validateCreateActiveTaskRequest,
} from "./active-task";
import {
  activeTaskPickerLimitMessage,
  buildActiveTaskEditDraft,
  buildBulkPersonSelection,
  buildSinglePersonSelection,
  canShowBoardTaskEdit,
  canShowTaskPageEdit,
  formatTaskMetadataTimestamp,
  getActiveTaskBulkPresentation,
  nextActiveTaskPickerLimitAttempt,
  parseStoredTaskPriority,
  prepareActiveTaskEditSubmission,
  shouldApplyActiveTaskLoadResult,
} from "./active-task-ui";
import type { TaskDetail } from "./detail";
import type { TaskEditControlData } from "./edit-controls";

const eventBoardSource = readFileSync(
  "src/components/events/event-board.tsx",
  "utf8",
);
const eventBoardPageSource = readFileSync(
  "src/app/(dashboard)/events/[eventId]/page.tsx",
  "utf8",
);

const committeeId = "30000000-0000-4000-8000-000000000001";
const otherCommitteeId = "30000000-0000-4000-8000-000000000002";

const task: TaskDetail = {
  id: "20000000-0000-4000-8000-000000000001",
  event_id: "10000000-0000-4000-8000-000000000001",
  event_name: "CEIT Week",
  event_status: "Active",
  title: "Prepare venue",
  description: "Confirm access.",
  phase: "Preparation",
  status: "To Do",
  effective_priority: "Critical",
  task_type: "Deliverable",
  due_date: "2026-10-30T00:00:00+00:00",
  call_time: null,
  end_time: null,
  created_at: "2026-10-28T11:00:00+00:00",
  updated_at: "2026-10-28T12:00:00.123456+00:00",
  committee_id: committeeId,
  committee_name: "Logistics",
  primary_assignees: [],
  assist_assignees: [],
  is_confidential: false,
  is_masked: false,
  has_dependency: false,
  is_blocked: false,
  dependency_label: null,
  access_list: [],
};

const controls: TaskEditControlData = {
  can_set_dependency: true,
  can_set_confidentiality: true,
  can_edit_task: true,
  can_assign_people: true,
  can_delete: true,
  can_unassign_self: false,
  self_unassign_block_code: null,
  self_unassign_will_lose_access: false,
  depends_on_task_id: null,
  is_confidential: false,
  allowed_viewers: [],
  dependency_options: [],
  viewer_options: [],
  primary_assignees: [],
  assist_assignees: [],
  assignee_options: [],
};

const boardTask: BoardTask = {
  id: task.id,
  title: task.title,
  phase: task.phase,
  status: task.status,
  effective_priority: task.effective_priority,
  due_date: task.due_date,
  committee_id: committeeId,
  committee_name: task.committee_name,
  primary_assignees: [],
  assist_assignees: [],
  is_backlog: false,
  is_masked: false,
};

describe("active task Edit prefill", () => {
  it("uses stored Low when calculated priority is Critical and preserves Low on a no-op save", () => {
    const draft = buildActiveTaskEditDraft(task, controls, "Low");
    expect(task.effective_priority).toBe("Critical");
    expect(draft?.priority).toBe("Low");
    expect(
      editActiveTaskRpcArgs({
        ...draft!,
        taskId: task.id,
        expectedUpdatedAt: task.updated_at!,
      }).p_priority,
    ).toBe("Low");
  });

  it("normalizes only redundant assignee viewers without rewriting a no-op edit", () => {
    const primaryId = "40000000-0000-4000-8000-000000000001";
    const assistId = "40000000-0000-4000-8000-000000000002";
    const inactiveViewerId = "40000000-0000-4000-8000-000000000003";
    const initial = buildActiveTaskEditDraft(
      task,
      {
        ...controls,
        is_confidential: true,
        primary_assignees: [{ id: primaryId, full_name: "Primary", avatar_url: null }],
        assist_assignees: [{ id: assistId, full_name: "Assist", avatar_url: null }],
        allowed_viewers: [
          { id: primaryId, full_name: "Primary", avatar_url: null },
          { id: assistId, full_name: "Assist", avatar_url: null },
          { id: inactiveViewerId, full_name: "Inactive viewer", avatar_url: null },
        ],
      },
      "Low",
    )!;
    expect(initial.allowedViewerIds).toEqual([inactiveViewerId]);

    const request = vi.fn();
    const redundantOnly = prepareActiveTaskEditSubmission(
      { ...initial, allowedViewerIds: [primaryId, assistId, inactiveViewerId] },
      initial,
      [assistId],
    );
    if (redundantOnly) request(redundantOnly);
    expect(redundantOnly).toBeNull();
    expect(request).not.toHaveBeenCalled();

    const realChange = prepareActiveTaskEditSubmission(
      {
        ...initial,
        title: "Changed title",
        allowedViewerIds: [primaryId, assistId, inactiveViewerId],
      },
      initial,
      [assistId],
    );
    if (realChange) request(realChange);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ allowedViewerIds: [inactiveViewerId] }),
    );
  });

  it("never applies an Edit background load over typed values or its token", () => {
    expect(shouldApplyActiveTaskLoadResult("edit", true)).toBe(false);
    expect(shouldApplyActiveTaskLoadResult("edit", false)).toBe(true);
    expect(shouldApplyActiveTaskLoadResult("add", true)).toBe(true);
  });

  it("accepts only a valid stored priority and treats null as unavailable", () => {
    expect(parseStoredTaskPriority("High")).toBe("High");
    expect(parseStoredTaskPriority(null)).toBeNull();
    expect(parseStoredTaskPriority("Urgent")).toBeUndefined();
  });
});

describe("active task edit visibility", () => {
  it("shows board Add Task only on an Active board for an active Admin or Co-Admin profile", () => {
    expect(eventBoardSource).toContain(
      'const canAddTask = viewer.role === "Admin" || viewer.role === "Co-Admin"',
    );
    expect(eventBoardPageSource).toMatch(
      /getActiveProfileForRoles\(\[\s*"Admin",\s*"Co-Admin",\s*"Member",\s*\]\)/,
    );
    expect(eventBoardPageSource).toContain(
      'if (!profile) redirect("/home")',
    );
    expect(eventBoardPageSource).toContain('.eq("status", "Active")');
  });

  it("shows board Edit to Admin and the owning Co-Admin only", () => {
    expect(canShowBoardTaskEdit({ role: "Admin", committeeId: null }, boardTask)).toBe(true);
    expect(canShowBoardTaskEdit({ role: "Co-Admin", committeeId }, boardTask)).toBe(true);
    expect(canShowBoardTaskEdit({ role: "Co-Admin", committeeId: otherCommitteeId }, boardTask)).toBe(false);
    expect(canShowBoardTaskEdit({ role: "Member", committeeId }, boardTask)).toBe(false);
    expect(canShowBoardTaskEdit({ role: "Admin", committeeId: null }, { ...boardTask, is_masked: true })).toBe(false);
  });

  it("hides task-page Edit for masked, Draft, Archived, or denied tasks", () => {
    expect(canShowTaskPageEdit(task, controls)).toBe(true);
    expect(canShowTaskPageEdit({ ...task, is_masked: true }, controls)).toBe(false);
    expect(canShowTaskPageEdit({ ...task, event_status: "Draft" }, controls)).toBe(false);
    expect(canShowTaskPageEdit({ ...task, event_status: "Archived" }, controls)).toBe(false);
    expect(canShowTaskPageEdit(task, { ...controls, can_edit_task: false })).toBe(false);
  });
});

describe("active task committee bulk selection", () => {
  it("hides zero-member controls and shows Clear only for selected visible members", () => {
    expect(getActiveTaskBulkPresentation("CARA", 0, 0, 0)).toEqual({
      showControls: false,
      showClear: false,
      emptyMessage: "No active CARA members",
    });
    expect(getActiveTaskBulkPresentation("CARA", 2, 0, 0)).toEqual({
      showControls: false,
      showClear: false,
      emptyMessage: "No CARA members match this search",
    });
    expect(getActiveTaskBulkPresentation("CARA", 2, 2, 0)).toEqual({
      showControls: true,
      showClear: false,
      emptyMessage: null,
    });
    expect(getActiveTaskBulkPresentation("CARA", 2, 2, 1)).toEqual({
      showControls: true,
      showClear: true,
      emptyMessage: null,
    });
  });

  it("treats zero committee matches with three outside selections as a no-op without a cap error", () => {
    const selectedIds = ["cia", "coexa", "dis"];
    const attempt = buildBulkPersonSelection(selectedIds, [], true, 100);
    expect(attempt).toEqual({
      ids: selectedIds,
      attemptedCount: 3,
      exceedsLimit: false,
    });
    expect(
      nextActiveTaskPickerLimitAttempt({
        type: "overflow",
        kind: "primary",
        attemptedCount: attempt.attemptedCount,
      }),
    ).toBeNull();
  });

  it("adds only matching bulk ids below the cap and preserves previously selected outsiders", () => {
    const attempt = buildBulkPersonSelection(
      ["selected-outside"],
      ["cara-1", "cara-2"],
      true,
      100,
    );
    expect(attempt).toEqual({
      ids: ["selected-outside", "cara-1", "cara-2"],
      attemptedCount: 3,
      exceedsLimit: false,
    });
    expect(attempt.ids).not.toContain("unselected-outside");
  });

  it("allows exactly 100 and applies nothing for assignee 101 or viewer 51", () => {
    const first99 = Array.from({ length: 99 }, (_, index) => `primary-${index}`);
    const exactly100 = buildBulkPersonSelection(first99, ["primary-99"], true, 100);
    expect(exactly100).toMatchObject({ attemptedCount: 100, exceedsLimit: false });

    const primaryIds = Array.from({ length: 100 }, (_, index) => `primary-${index}`);
    const primaryOverflow = buildSinglePersonSelection(
      primaryIds,
      "primary-101",
      true,
      100,
    );
    expect(primaryOverflow).toMatchObject({ attemptedCount: 101, exceedsLimit: true });
    const appliedPrimaryIds = primaryOverflow.exceedsLimit
      ? primaryIds
      : primaryOverflow.ids;
    expect(appliedPrimaryIds).toBe(primaryIds);
    expect(buildSinglePersonSelection(primaryIds, "primary-0", false, 100)).toMatchObject({
      attemptedCount: 99,
      exceedsLimit: false,
    });

    const viewerIds = Array.from({ length: 50 }, (_, index) => `viewer-${index}`);
    const viewerOverflow = buildSinglePersonSelection(
      viewerIds,
      "viewer-51",
      true,
      50,
    );
    expect(viewerOverflow).toMatchObject({ attemptedCount: 51, exceedsLimit: true });
    const appliedViewerIds = viewerOverflow.exceedsLimit
      ? viewerIds
      : viewerOverflow.ids;
    expect(appliedViewerIds).toBe(viewerIds);
    expect(buildSinglePersonSelection(viewerIds, "viewer-0", false, 50)).toMatchObject({
      attemptedCount: 49,
      exceedsLimit: false,
    });
  });

  it("derives cap text from the real attempted count and clears only picker-limit state", () => {
    const overflow = nextActiveTaskPickerLimitAttempt({
      type: "overflow",
      kind: "primary",
      attemptedCount: 101,
    });
    expect(activeTaskPickerLimitMessage(overflow)).toBe("Select up to 100 people.");
    expect(activeTaskPickerLimitMessage(nextActiveTaskPickerLimitAttempt({ type: "clear" }))).toBeNull();
    expect(
      activeTaskPickerLimitMessage(
        nextActiveTaskPickerLimitAttempt({
          type: "overflow",
          kind: "viewer",
          attemptedCount: 50,
        }),
      ),
    ).toBeNull();
  });

  it("clears a displayed assignee-cap message after removing one of ten selected people", () => {
    const selectedIds = Array.from({ length: 10 }, (_, index) =>
      index === 0
        ? "01900000-0000-7000-8000-000000000001"
        : `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    const validation = validateCreateActiveTaskRequest({
      eventId: "10000000-0000-4000-8000-000000000001",
      title: "Prepare venue",
      description: "",
      phase: "Preparation",
      committeeId,
      priority: "Medium",
      taskType: "Deliverable",
      dueDate: "",
      dutyDate: "",
      callTime: "",
      endTime: "",
      primaryAssigneeIds: selectedIds,
      isConfidential: false,
      allowedViewerIds: [],
    });
    expect(validation).toMatchObject({ ok: true });

    const removal = buildSinglePersonSelection(
      selectedIds,
      selectedIds[1],
      false,
      100,
    );
    expect(removal).toMatchObject({ attemptedCount: 9, exceedsLimit: false });
    const pickerLimitAfterRemoval = nextActiveTaskPickerLimitAttempt({
      type: "clear",
    });
    const displayedMessages = [
      validation.ok ? null : validation.message,
      activeTaskPickerLimitMessage(pickerLimitAfterRemoval),
    ].filter(Boolean);

    expect(displayedMessages).not.toContain("Select up to 100 people.");
  });
});

describe("task metadata time", () => {
  it("formats absolute timestamps in Asia/Manila", () => {
    expect(
      formatTaskMetadataTimestamp("2026-10-28T12:00:00+00:00").replace(
        /\u202f/g,
        " ",
      ),
    ).toBe("Oct 28, 2026, 8:00 PM");
  });
});

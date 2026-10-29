import type { BoardTask } from "../events/board";
import { splitAppTimestamp, APP_TIME_ZONE } from "../timezone";
import {
  ACTIVE_TASK_PRIORITIES,
  type ActiveTaskDraft,
  type ActiveTaskPriority,
} from "./active-task";
import type { TaskDetail } from "./detail";
import type { TaskEditControlData } from "./edit-controls";

export type ActiveTaskViewer = {
  role: "Admin" | "Co-Admin" | "Member";
  committeeId: string | null;
};

export function normalizeActiveTaskViewerIds(
  viewerIds: readonly string[],
  primaryAssigneeIds: readonly string[],
  assistAssigneeIds: readonly string[],
) {
  const assigneeIds = new Set([...primaryAssigneeIds, ...assistAssigneeIds]);
  return [...new Set(viewerIds)].filter((id) => !assigneeIds.has(id));
}

export function normalizeActiveTaskDraft(
  draft: ActiveTaskDraft,
  assistAssigneeIds: readonly string[],
): ActiveTaskDraft {
  return {
    ...draft,
    allowedViewerIds: normalizeActiveTaskViewerIds(
      draft.allowedViewerIds,
      draft.primaryAssigneeIds,
      assistAssigneeIds,
    ),
  };
}

export function activeTaskDraftsEqual(
  left: ActiveTaskDraft,
  right: ActiveTaskDraft,
  assistAssigneeIds: readonly string[],
) {
  const comparable = (draft: ActiveTaskDraft) => {
    const normalized = normalizeActiveTaskDraft(draft, assistAssigneeIds);
    return {
      ...normalized,
      primaryAssigneeIds: [...normalized.primaryAssigneeIds].sort(),
      allowedViewerIds: [...normalized.allowedViewerIds].sort(),
    };
  };
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function prepareActiveTaskEditSubmission(
  draft: ActiveTaskDraft,
  initialDraft: ActiveTaskDraft,
  assistAssigneeIds: readonly string[],
) {
  const normalized = normalizeActiveTaskDraft(draft, assistAssigneeIds);
  return activeTaskDraftsEqual(normalized, initialDraft, assistAssigneeIds)
    ? null
    : normalized;
}

export function shouldApplyActiveTaskLoadResult(
  mode: "add" | "edit",
  background: boolean,
) {
  return mode === "add" || !background;
}

export function buildBulkPersonSelection(
  selectedIds: readonly string[],
  visibleIds: readonly string[],
  checked: boolean,
  limit: number,
) {
  let ids: string[];
  if (!checked) {
    const visibleSet = new Set(visibleIds);
    ids = selectedIds.filter((id) => !visibleSet.has(id));
  } else {
    ids = [...new Set([...selectedIds, ...visibleIds])];
  }
  return {
    ids,
    attemptedCount: ids.length,
    exceedsLimit: ids.length > limit,
  };
}

export function buildSinglePersonSelection(
  selectedIds: readonly string[],
  personId: string,
  checked: boolean,
  limit: number,
) {
  const ids = checked
    ? [...new Set([...selectedIds, personId])]
    : selectedIds.filter((id) => id !== personId);
  return {
    ids,
    attemptedCount: ids.length,
    exceedsLimit: ids.length > limit,
  };
}

export function getActiveTaskBulkPresentation(
  committeeName: string,
  availableCommitteeCount: number,
  visibleCommitteeCount: number,
  selectedVisibleCount: number,
) {
  if (availableCommitteeCount === 0) {
    return {
      showControls: false,
      showClear: false,
      emptyMessage: `No active ${committeeName} members`,
    };
  }
  if (visibleCommitteeCount === 0) {
    return {
      showControls: false,
      showClear: false,
      emptyMessage: `No ${committeeName} members match this search`,
    };
  }
  return {
    showControls: true,
    showClear: selectedVisibleCount > 0,
    emptyMessage: null,
  };
}

export type ActiveTaskPickerLimitAttempt = {
  kind: "primary" | "viewer";
  attemptedCount: number;
};

export function nextActiveTaskPickerLimitAttempt(
  action:
    | { type: "overflow"; kind: "primary" | "viewer"; attemptedCount: number }
    | { type: "clear" },
): ActiveTaskPickerLimitAttempt | null {
  if (action.type === "clear") return null;
  const limit = action.kind === "primary" ? 100 : 50;
  return action.attemptedCount > limit
    ? { kind: action.kind, attemptedCount: action.attemptedCount }
    : null;
}

export function activeTaskPickerLimitMessage(
  attempt: ActiveTaskPickerLimitAttempt | null,
) {
  if (!attempt) return null;
  if (attempt.kind === "primary" && attempt.attemptedCount > 100) {
    return "Select up to 100 people.";
  }
  if (attempt.kind === "viewer" && attempt.attemptedCount > 50) {
    return "Select up to 50 additional viewers.";
  }
  return null;
}

export function parseStoredTaskPriority(
  value: unknown,
): ActiveTaskPriority | null | undefined {
  if (value === null) return null;
  if (
    typeof value === "string" &&
    ACTIVE_TASK_PRIORITIES.includes(value as ActiveTaskPriority)
  ) {
    return value as ActiveTaskPriority;
  }
  return undefined;
}

export function buildActiveTaskEditDraft(
  task: TaskDetail,
  controls: TaskEditControlData,
  storedPriority: ActiveTaskPriority,
): ActiveTaskDraft | null {
  if (
    task.is_masked ||
    task.event_status !== "Active" ||
    !task.committee_id ||
    !task.task_type ||
    !controls.can_edit_task
  ) {
    return null;
  }
  const call = splitAppTimestamp(task.call_time) ?? { date: "", time: "" };
  const end = splitAppTimestamp(task.end_time) ?? { date: "", time: "" };
  return {
    title: task.title,
    description: task.description ?? "",
    phase: task.phase?.trim() || "Unphased",
    committeeId: task.committee_id,
    priority: storedPriority,
    taskType: task.task_type,
    dueDate: task.due_date?.slice(0, 10) ?? "",
    dutyDate: call.date,
    callTime: call.time,
    endTime: end.time,
    primaryAssigneeIds: controls.primary_assignees.map((person) => person.id),
    isConfidential: controls.is_confidential === true,
    allowedViewerIds: normalizeActiveTaskViewerIds(
      controls.allowed_viewers.map((person) => person.id),
      controls.primary_assignees.map((person) => person.id),
      controls.assist_assignees.map((person) => person.id),
    ),
  };
}

export function canShowBoardTaskEdit(
  viewer: ActiveTaskViewer,
  task: BoardTask,
) {
  return (
    !task.is_masked &&
    (viewer.role === "Admin" ||
      (viewer.role === "Co-Admin" &&
        viewer.committeeId !== null &&
        viewer.committeeId === task.committee_id))
  );
}

export function canShowTaskPageEdit(
  task: TaskDetail,
  controls: TaskEditControlData | null | undefined,
) {
  return (
    !task.is_masked &&
    task.event_status === "Active" &&
    controls?.can_edit_task === true
  );
}

const taskMetadataFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE.iana,
});

export function formatTaskMetadataTimestamp(value: string) {
  return taskMetadataFormatter.format(new Date(value));
}

import { BOARD_STATUSES, type BoardStatus } from "../events/board";

export const MAX_TASK_ALLOWED_VIEWERS = 50;
export const MAX_TASK_ASSIGNEES = 100;

export type TaskEditViewer = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export type TaskDependencyOption = {
  id: string;
  label: string;
  status: BoardStatus;
};

export type TaskEditControlData = {
  can_set_dependency: boolean;
  can_set_confidentiality: boolean;
  can_edit_task: boolean;
  can_assign_people: boolean;
  can_delete: boolean;
  can_unassign_self: boolean;
  self_unassign_block_code: "completed" | "due" | null;
  self_unassign_will_lose_access: boolean;
  depends_on_task_id: string | null;
  is_confidential: boolean | null;
  allowed_viewers: TaskEditViewer[];
  dependency_options: TaskDependencyOption[];
  viewer_options: TaskEditViewer[];
  primary_assignees: TaskEditViewer[];
  assist_assignees: TaskEditViewer[];
  assignee_options: TaskEditViewer[];
};

export type TaskPeopleMutationResult = {
  out_task_id: string;
  out_status: BoardStatus;
  out_sort_order: number | string;
  out_primary_assignees: string[];
  out_assist_assignees: string[];
};

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isViewer(value: unknown): value is TaskEditViewer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    isNullableString(row.full_name) &&
    isNullableString(row.avatar_url)
  );
}

function isDependencyOption(value: unknown): value is TaskDependencyOption {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.label === "string" &&
    BOARD_STATUSES.includes(row.status as BoardStatus)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

export function isTaskPeopleMutationResult(
  value: unknown,
): value is TaskPeopleMutationResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_task_id === "string" &&
    BOARD_STATUSES.includes(row.out_status as BoardStatus) &&
    ((typeof row.out_sort_order === "number" &&
      Number.isInteger(row.out_sort_order)) ||
      (typeof row.out_sort_order === "string" &&
        /^\d+$/.test(row.out_sort_order))) &&
    isStringArray(row.out_primary_assignees) &&
    isStringArray(row.out_assist_assignees)
  );
}

export function isTaskDeleteResult(value: unknown) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>).out_task_id === "string",
  );
}

export function isTaskEditControlData(
  value: unknown,
): value is TaskEditControlData {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;

  if (
    typeof row.can_set_dependency !== "boolean" ||
    typeof row.can_set_confidentiality !== "boolean" ||
    typeof row.can_edit_task !== "boolean" ||
    typeof row.can_assign_people !== "boolean" ||
    typeof row.can_delete !== "boolean" ||
    typeof row.can_unassign_self !== "boolean" ||
    !(
      row.self_unassign_block_code === null ||
      row.self_unassign_block_code === "completed" ||
      row.self_unassign_block_code === "due"
    ) ||
    typeof row.self_unassign_will_lose_access !== "boolean" ||
    !isNullableString(row.depends_on_task_id) ||
    !Array.isArray(row.allowed_viewers) ||
    !row.allowed_viewers.every(isViewer) ||
    !Array.isArray(row.dependency_options) ||
    !row.dependency_options.every(isDependencyOption) ||
    !Array.isArray(row.viewer_options) ||
    !row.viewer_options.every(isViewer) ||
    !Array.isArray(row.primary_assignees) ||
    !row.primary_assignees.every(isViewer) ||
    !Array.isArray(row.assist_assignees) ||
    !row.assist_assignees.every(isViewer) ||
    !Array.isArray(row.assignee_options) ||
    !row.assignee_options.every(isViewer)
  ) {
    return false;
  }

  if (
    (row.can_delete && !row.can_assign_people) ||
    (row.can_unassign_self && row.self_unassign_block_code !== null) ||
    (!row.can_assign_people &&
      (row.primary_assignees.length > 0 ||
        row.assist_assignees.length > 0 ||
        row.assignee_options.length > 0))
  ) {
    return false;
  }

  if (
    !row.can_set_dependency &&
    (row.depends_on_task_id !== null || row.dependency_options.length > 0)
  ) {
    return false;
  }

  if (row.can_set_confidentiality) {
    return typeof row.is_confidential === "boolean";
  }

  return (
    row.is_confidential === null &&
    row.allowed_viewers.length === 0 &&
    row.viewer_options.length === 0
  );
}

export function confidentialityViewerIds(
  isConfidential: boolean,
  viewerIds: string[],
) {
  if (!isConfidential) return [];
  return [...new Set(viewerIds)];
}

export function assigneeIdsAreUnchanged(
  currentPrimaryIds: string[],
  currentAssistIds: string[],
  nextPrimaryIds: string[],
  nextAssistIds: string[],
) {
  return (
    currentPrimaryIds.length === nextPrimaryIds.length &&
    currentAssistIds.length === nextAssistIds.length &&
    currentPrimaryIds.every((id) => nextPrimaryIds.includes(id)) &&
    currentAssistIds.every((id) => nextAssistIds.includes(id))
  );
}

type RpcErrorLike = {
  code?: string;
  message?: string;
};

export function getTaskEditErrorMessage(
  error: unknown,
  action:
    "dependency" | "confidentiality" | "assignment" | "delete" | "unassign",
) {
  const rpcError =
    error && typeof error === "object" ? (error as RpcErrorLike) : null;
  const message = rpcError?.message ?? "";

  if (rpcError?.code === "CCN01") return "Assignees are already up to date";
  if (rpcError?.code === "CCU72") {
    return "This task is due within 72 hours. Ask an Admin or Co-Admin to remove you.";
  }
  if (rpcError?.code === "CCU73") {
    return "Completed tasks cannot be self-unassigned. Ask an Admin or Co-Admin to update the assignees.";
  }

  if (message.includes("Complete the prerequisite")) return message;
  if (message.includes("cannot depend on itself")) return message;
  if (message.includes("same event")) return message;
  if (message.includes("create a cycle")) return message;
  if (message.includes("prerequisite task does not exist")) return message;
  if (message.includes("prerequisite task is unavailable")) {
    return "That prerequisite is no longer available. Choose another or clear it.";
  }
  if (message.includes("at most 50")) return message;
  if (message.includes("selected only once")) return message;
  if (message.includes("newly added viewer")) return message;
  if (message.includes("cannot keep additional viewers")) return message;
  if (message.includes("Archived") || message.includes("read-only")) {
    return "Tasks in archived events are read-only.";
  }
  if (message.includes("Only a To Do task")) return message;
  if (message.includes("another task depends")) return message;
  if (message.includes("Active event must have at least one task"))
    return message;
  if (message.includes("more than 100 assignees")) return message;
  if (message.includes("both a primary and assist")) return message;
  if (message.includes("newly added assignees")) return message;
  if (rpcError?.code === "42501") {
    return "You no longer have permission to make this change.";
  }
  if (rpcError?.code === "40001") {
    return "The task changed. Refresh the page and try again.";
  }

  if (action === "dependency") {
    return "The dependency could not be saved. Please try again.";
  }
  if (action === "confidentiality") {
    return "The confidentiality settings could not be saved. Please try again.";
  }
  if (action === "assignment") {
    return "The assignees could not be saved. Please try again.";
  }
  if (action === "delete") {
    return "The task could not be deleted. Please try again.";
  }
  return "You could not leave this task. Please try again.";
}

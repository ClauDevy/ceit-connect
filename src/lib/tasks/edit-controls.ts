import { BOARD_STATUSES, type BoardStatus } from "../events/board";

export const MAX_TASK_ALLOWED_VIEWERS = 50;

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
  depends_on_task_id: string | null;
  is_confidential: boolean | null;
  allowed_viewers: TaskEditViewer[];
  dependency_options: TaskDependencyOption[];
  viewer_options: TaskEditViewer[];
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

export function isTaskEditControlData(
  value: unknown,
): value is TaskEditControlData {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;

  if (
    typeof row.can_set_dependency !== "boolean" ||
    typeof row.can_set_confidentiality !== "boolean" ||
    !isNullableString(row.depends_on_task_id) ||
    !Array.isArray(row.allowed_viewers) ||
    !row.allowed_viewers.every(isViewer) ||
    !Array.isArray(row.dependency_options) ||
    !row.dependency_options.every(isDependencyOption) ||
    !Array.isArray(row.viewer_options) ||
    !row.viewer_options.every(isViewer)
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

type RpcErrorLike = {
  code?: string;
  message?: string;
};

export function getTaskEditErrorMessage(
  error: unknown,
  action: "dependency" | "confidentiality",
) {
  const rpcError =
    error && typeof error === "object" ? (error as RpcErrorLike) : null;
  const message = rpcError?.message ?? "";

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
  if (rpcError?.code === "42501") {
    return "You no longer have permission to make this change.";
  }
  if (rpcError?.code === "40001") {
    return "The task changed. Refresh the page and try again.";
  }

  return action === "dependency"
    ? "The dependency could not be saved. Please try again."
    : "The confidentiality settings could not be saved. Please try again.";
}

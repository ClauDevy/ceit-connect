export const TASK_COMMENT_PAGE_SIZE = 25;
export const MAX_TASK_COMMENT_CODE_POINTS = 4000;
export const MAX_TASK_COMMENT_MENTIONS = 20;
export const MAX_TASK_COMMENT_MENTION_SEARCH_CODE_POINTS = 100;

export type TaskCommentMention = {
  id: string;
  full_name: string;
};

export type TaskComment = {
  out_id: string;
  out_body: string;
  out_is_heads_up: boolean;
  out_created_at: string;
  out_edited_at: string | null;
  out_author_id: string;
  out_author_full_name: string;
  out_author_avatar_url: string | null;
  out_mentions: TaskCommentMention[];
  out_can_edit: boolean;
  out_can_delete: boolean;
  out_has_more: boolean;
};

export type TaskCommentMentionCandidate = {
  out_id: string;
  out_full_name: string;
  out_avatar_url: string | null;
};

export type AddTaskCommentResult = {
  out_id: string;
  out_created_at: string;
};

export type EditTaskCommentResult = {
  out_id: string;
  out_edited_at: string;
};

export type TaskCommentAction =
  "read" | "candidates" | "add" | "edit" | "delete";

type RpcErrorLike = { code?: unknown };

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isTaskCommentMention(value: unknown): value is TaskCommentMention {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.full_name === "string";
}

export function isTaskComment(value: unknown): value is TaskComment {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_id === "string" &&
    typeof row.out_body === "string" &&
    typeof row.out_is_heads_up === "boolean" &&
    typeof row.out_created_at === "string" &&
    isNullableString(row.out_edited_at) &&
    typeof row.out_author_id === "string" &&
    typeof row.out_author_full_name === "string" &&
    isNullableString(row.out_author_avatar_url) &&
    Array.isArray(row.out_mentions) &&
    row.out_mentions.every(isTaskCommentMention) &&
    typeof row.out_can_edit === "boolean" &&
    typeof row.out_can_delete === "boolean" &&
    typeof row.out_has_more === "boolean"
  );
}

export function isTaskCommentMentionCandidate(
  value: unknown,
): value is TaskCommentMentionCandidate {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_id === "string" &&
    typeof row.out_full_name === "string" &&
    isNullableString(row.out_avatar_url)
  );
}

export function isAddTaskCommentResult(
  value: unknown,
): value is AddTaskCommentResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_id === "string" && typeof row.out_created_at === "string"
  );
}

export function isEditTaskCommentResult(
  value: unknown,
): value is EditTaskCommentResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_id === "string" && typeof row.out_edited_at === "string"
  );
}

export function trimTaskCommentBody(body: string) {
  return body.trim();
}

export function countCodePoints(value: string) {
  return Array.from(value).length;
}

export function truncateCodePoints(value: string, maximum: number) {
  return Array.from(value).slice(0, maximum).join("");
}

export function mergeTaskCommentPages(
  current: TaskComment[],
  incoming: TaskComment[],
) {
  const byId = new Map(current.map((comment) => [comment.out_id, comment]));
  for (const comment of incoming) byId.set(comment.out_id, comment);
  return [...byId.values()].sort((left, right) => {
    const timeDifference =
      new Date(right.out_created_at).getTime() -
      new Date(left.out_created_at).getTime();
    if (timeDifference !== 0) return timeDifference;
    return right.out_id.localeCompare(left.out_id);
  });
}

export function getTaskCommentErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = (error as RpcErrorLike).code;
  return typeof code === "string" ? code : "";
}

export function isTaskCommentUnavailableError(error: unknown) {
  return getTaskCommentErrorCode(error) === "CCC01";
}

export function isTaskCommentRetryableError(error: unknown) {
  const code = getTaskCommentErrorCode(error);
  return code === "40001" || code === "40P01";
}

const safeCodeMessages: Record<string, string> = {
  CCC01: "Comments are no longer available for this task.",
  CCC02: "The comments request is no longer valid. Refresh and try again.",
  CCC03: "A comment must contain between 1 and 4,000 characters.",
  CCC04:
    "One or more mentioned people are no longer available. Update the mentions and try again.",
  CCC05: "Archived task comments are read only.",
  CCC06: "Only the comment author can edit it.",
  CCC07: "You no longer have permission to delete this comment.",
  CCC08: "This comment changed. Refresh and try again.",
  CCC09: "Make a change before saving the comment.",
  CCC10: "The comment could not be changed safely. Refresh and try again.",
  "40001": "Comments changed while saving. Refresh and try again.",
  "40P01": "Comments are busy right now. Refresh and try again.",
};

const actionFallbacks: Record<TaskCommentAction, string> = {
  read: "Comments could not be loaded. Please try again.",
  candidates: "People available to mention could not be loaded.",
  add: "The comment could not be added. Please try again.",
  edit: "The comment could not be saved. Please try again.",
  delete: "The comment could not be deleted. Please try again.",
};

export function getTaskCommentErrorMessage(
  error: unknown,
  action: TaskCommentAction,
) {
  const code = getTaskCommentErrorCode(error);
  return safeCodeMessages[code] ?? actionFallbacks[action];
}

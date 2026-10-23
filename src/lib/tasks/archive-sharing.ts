export const MAX_ARCHIVED_TASK_VIEWER_SEARCH_LENGTH = 100;

export type ArchivedTaskShareControl = {
  out_id: string;
  out_full_name: string;
  out_avatar_url: string | null;
  out_is_archive_only: boolean;
};

export type ArchivedTaskShareAction = "read" | "grant" | "revoke";

type RpcErrorLike = {
  code?: unknown;
};

export type ArchivedTaskViewerSearch =
  | { ok: true; value: string | null }
  | { ok: false; message: string };

export function isArchivedTaskShareControl(
  value: unknown,
): value is ArchivedTaskShareControl {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;

  return (
    typeof row.out_id === "string" &&
    typeof row.out_full_name === "string" &&
    (row.out_avatar_url === null || typeof row.out_avatar_url === "string") &&
    typeof row.out_is_archive_only === "boolean"
  );
}

export function normalizeArchivedTaskViewerSearch(
  input: string,
): ArchivedTaskViewerSearch {
  const value = input.trim();
  if (value.length > MAX_ARCHIVED_TASK_VIEWER_SEARCH_LENGTH) {
    return {
      ok: false,
      message: `Search must be ${MAX_ARCHIVED_TASK_VIEWER_SEARCH_LENGTH} characters or fewer.`,
    };
  }
  return { ok: true, value: value || null };
}

export function getArchivedTaskShareErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const code = (error as RpcErrorLike).code;
  return typeof code === "string" ? code : "";
}

export function isArchivedTaskShareRetryableError(error: unknown) {
  const code = getArchivedTaskShareErrorCode(error);
  return code === "40001" || code === "40P01";
}

export function isArchivedTaskShareUnavailableError(error: unknown) {
  const code = getArchivedTaskShareErrorCode(error);
  return code === "CCS01" || code === "CCS02";
}

const safeCodeMessages: Record<string, string> = {
  CCS01: "You can no longer manage access for this task.",
  CCS02: "Archive-only sharing is no longer available for this task.",
  CCS03: "The selected active user is no longer available.",
  CCS04: "This person already has full access to the task.",
  CCS05: "This archive-only share no longer exists.",
  CCS06: "Search must be 100 characters or fewer.",
  "40001": "Access changed while saving. The page was refreshed; please try again.",
  "40P01": "Access is busy right now. The page was refreshed; please try again.",
};

const actionFallbacks: Record<ArchivedTaskShareAction, string> = {
  read: "Sharing controls could not be loaded. Please try again.",
  grant: "Access could not be granted. Please try again.",
  revoke: "Access could not be revoked. Please try again.",
};

export function getArchivedTaskShareErrorMessage(
  error: unknown,
  action: ArchivedTaskShareAction,
) {
  const code = getArchivedTaskShareErrorCode(error);
  return safeCodeMessages[code] ?? actionFallbacks[action];
}

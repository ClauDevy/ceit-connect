export type PhaseCompletionReaderState = {
  phaseComplete: boolean;
  canReopen: boolean;
  reopenUpdatedAt: string | null;
};

type PhaseCompletionFieldNames = {
  phaseComplete: string;
  canReopen: string;
  updatedAt: string;
};

const BOARD_FIELDS: PhaseCompletionFieldNames = {
  phaseComplete: "phase_complete",
  canReopen: "can_reopen",
  updatedAt: "updated_at",
};

const DRAFT_FIELDS: PhaseCompletionFieldNames = {
  phaseComplete: "out_phase_complete",
  canReopen: "out_can_reopen",
  updatedAt: "out_updated_at",
};

function hasOwn(row: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function parseReaderState(
  value: unknown,
  fields: PhaseCompletionFieldNames,
): PhaseCompletionReaderState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;

  const phaseComplete = hasOwn(row, fields.phaseComplete)
    ? row[fields.phaseComplete]
    : false;
  const canReopen = hasOwn(row, fields.canReopen)
    ? row[fields.canReopen]
    : false;
  const updatedAt = hasOwn(row, fields.updatedAt) ? row[fields.updatedAt] : null;

  if (
    typeof phaseComplete !== "boolean" ||
    typeof canReopen !== "boolean" ||
    (typeof updatedAt !== "string" && updatedAt !== null)
  ) {
    return null;
  }

  if (!phaseComplete && canReopen) return null;
  if (canReopen !== (updatedAt !== null)) return null;

  return {
    phaseComplete,
    canReopen,
    reopenUpdatedAt: updatedAt,
  };
}

export function parseBoardPhaseCompletionState(value: unknown) {
  return parseReaderState(value, BOARD_FIELDS);
}

export function parseDraftPhaseCompletionState(value: unknown) {
  return parseReaderState(value, DRAFT_FIELDS);
}

export function parseTaskDetailPhaseComplete(value: unknown): boolean | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const phaseComplete = hasOwn(row, "phase_complete")
    ? row.phase_complete
    : false;
  return typeof phaseComplete === "boolean" ? phaseComplete : null;
}

export const PHASE_COMPLETION_ERROR_MESSAGES = {
  CCQ01:
    "This phase is complete and read-only. The latest state has been loaded.",
  CCQ02: "Archived tasks are read-only. The latest state has been loaded.",
  CCQ03: "This task cannot be reopened.",
  CCQ04: "Archived phases cannot be reopened.",
  CCQ05:
    "This task changed after it was loaded. The latest state has been loaded; choose a task and try again.",
  CCQ06:
    "Only a completed task can reopen this phase. The latest state has been loaded.",
  CCQ07:
    "This phase is no longer complete. The latest state has been loaded.",
  "40001":
    "The task or phase changed while saving. The latest state has been loaded; try again.",
  "40P01":
    "The task or phase is busy. The latest state has been loaded; try again.",
} as const;

export type PhaseCompletionErrorCode =
  keyof typeof PHASE_COMPLETION_ERROR_MESSAGES;

export function getPhaseCompletionErrorCode(
  error: unknown,
): PhaseCompletionErrorCode | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  if (typeof code !== "string") return null;
  return Object.prototype.hasOwnProperty.call(
    PHASE_COMPLETION_ERROR_MESSAGES,
    code,
  )
    ? (code as PhaseCompletionErrorCode)
    : null;
}

export function getPhaseCompletionErrorMessage(error: unknown) {
  const code = getPhaseCompletionErrorCode(error);
  return code === null ? null : PHASE_COMPLETION_ERROR_MESSAGES[code];
}

export function shouldRefetchAfterPhaseCompletionError(error: unknown) {
  return getPhaseCompletionErrorCode(error) !== null;
}

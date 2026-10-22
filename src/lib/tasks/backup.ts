import type { BoardPriority, BoardStatus } from "@/lib/events/board";

export const HELP_WANTED_PAGE_SIZE = 50;

export const TASK_BACKUP_ACTIONS = [
  "claim",
  "toggle-backup",
  "volunteer",
  "withdraw",
  "accept",
] as const;

export const TASK_BACKUP_ERROR_CODES = [
  "CCB01",
  "CCB02",
  "CCB03",
  "CCB04",
  "CCB05",
  "CCB06",
  "CCB07",
  "CCB08",
  "CCB09",
  "CCB10",
  "42501",
  "40001",
  "40P01",
] as const;

export type TaskBackupAction = (typeof TASK_BACKUP_ACTIONS)[number];
export type TaskBackupErrorCode = (typeof TASK_BACKUP_ERROR_CODES)[number];

export type TaskVolunteer = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
};

export type TaskBackupState = {
  out_task_id: string;
  out_request_backup: boolean;
  out_can_toggle_backup: boolean;
  out_can_volunteer: boolean;
  out_has_volunteered: boolean;
  out_can_accept: boolean;
  out_volunteers: TaskVolunteer[];
};

export type HelpWantedTask = {
  out_id: string;
  out_title: string;
  out_event_id: string;
  out_event_name: string;
  out_phase: string | null;
  out_status: BoardStatus;
  out_effective_priority: BoardPriority;
  out_due_date: string | null;
  out_committee_id: string;
  out_committee_name: string;
  out_has_volunteered: boolean;
  out_can_volunteer: boolean;
};

type RpcErrorLike = { code?: string };

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isTaskVolunteer(value: unknown): value is TaskVolunteer {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    isNullableString(row.full_name) &&
    isNullableString(row.avatar_url) &&
    typeof row.created_at === "string"
  );
}

export function isTaskBackupState(value: unknown): value is TaskBackupState {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_task_id === "string" &&
    typeof row.out_request_backup === "boolean" &&
    typeof row.out_can_toggle_backup === "boolean" &&
    typeof row.out_can_volunteer === "boolean" &&
    typeof row.out_has_volunteered === "boolean" &&
    typeof row.out_can_accept === "boolean" &&
    Array.isArray(row.out_volunteers) &&
    row.out_volunteers.every(isTaskVolunteer) &&
    (!row.out_has_volunteered || row.out_can_volunteer)
  );
}

export function isHelpWantedTask(value: unknown): value is HelpWantedTask {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_id === "string" &&
    typeof row.out_title === "string" &&
    typeof row.out_event_id === "string" &&
    typeof row.out_event_name === "string" &&
    isNullableString(row.out_phase) &&
    ["To Do", "In Progress", "Completed"].includes(
      row.out_status as string,
    ) &&
    ["Low", "Medium", "High", "Critical"].includes(
      row.out_effective_priority as string,
    ) &&
    isNullableString(row.out_due_date) &&
    typeof row.out_committee_id === "string" &&
    typeof row.out_committee_name === "string" &&
    typeof row.out_has_volunteered === "boolean" &&
    typeof row.out_can_volunteer === "boolean"
  );
}

export function isClaimTaskResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_task_id === "string" &&
    isStringArray(row.out_primary_assignees)
  );
}

export function isBackupToggleResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_task_id === "string" &&
    typeof row.out_request_backup === "boolean"
  );
}

export function isVolunteerTaskResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_task_id === "string" &&
    typeof row.out_user_id === "string" &&
    typeof row.out_created_at === "string"
  );
}

export function isWithdrawVolunteerResult(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_task_id === "string" &&
    typeof row.out_user_id === "string"
  );
}

export type AcceptVolunteerOutcome =
  | "accepted"
  | "inactive_removed"
  | "already_assigned_removed";

export type AcceptVolunteerResult = {
  out_task_id: string;
  out_user_id: string;
  out_assist_assignees: string[];
  out_outcome: AcceptVolunteerOutcome;
};

export function isAcceptVolunteerResult(
  value: unknown,
): value is AcceptVolunteerResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_task_id === "string" &&
    typeof row.out_user_id === "string" &&
    isStringArray(row.out_assist_assignees) &&
    ["accepted", "inactive_removed", "already_assigned_removed"].includes(
      row.out_outcome as string,
    )
  );
}

export function isClaimableBacklogTask(task: {
  is_backlog: boolean;
  is_masked: boolean;
  status: BoardStatus;
}) {
  return task.is_backlog && !task.is_masked && task.status !== "Completed";
}

const actionFallbacks: Record<TaskBackupAction, string> = {
  claim: "The task could not be claimed. Please try again.",
  "toggle-backup": "The backup request could not be changed. Please try again.",
  volunteer: "You could not volunteer for this task. Please try again.",
  withdraw: "Your volunteer offer could not be withdrawn. Please try again.",
  accept: "The volunteer could not be accepted. Please try again.",
};

const sharedMessages: Partial<Record<TaskBackupErrorCode, string>> = {
  CCB01: "This task is no longer available.",
  CCB02: "Only tasks in active events can be changed.",
  CCB03: "This task is no longer available to claim.",
  CCB04: "You are already helping with this task.",
  CCB05: "This task is not currently accepting that backup change.",
  CCB07: "You are already assigned to this task.",
  CCB08: "Tasks in archived events are read-only.",
  CCB09: "Volunteer offers cannot be edited.",
  CCB10: "This task already has the maximum number of assignees.",
  "42501": "You no longer have permission to do that.",
  "40001": "The task changed. Refresh and try again.",
  "40P01": "The task is busy. Refresh and try again.",
};

export function getTaskBackupErrorMessage(
  action: TaskBackupAction,
  error: unknown,
) {
  const code =
    error && typeof error === "object"
      ? (error as RpcErrorLike).code
      : undefined;

  if (code === "CCB06") {
    if (action === "volunteer") {
      return "You've already volunteered for this task.";
    }
    if (action === "withdraw") return "No pending offer was found.";
    if (action === "accept") return "That offer is no longer pending.";
    return actionFallbacks[action];
  }

  if (
    code &&
    TASK_BACKUP_ERROR_CODES.includes(code as TaskBackupErrorCode) &&
    sharedMessages[code as TaskBackupErrorCode]
  ) {
    return sharedMessages[code as TaskBackupErrorCode]!;
  }

  return actionFallbacks[action];
}

export function getAcceptVolunteerOutcomeMessage(
  outcome: AcceptVolunteerOutcome,
) {
  if (outcome === "accepted") return "Volunteer accepted.";
  if (outcome === "inactive_removed") {
    return "That volunteer is no longer active, so the offer was removed.";
  }
  return "That person is already assigned, so the pending offer was removed.";
}

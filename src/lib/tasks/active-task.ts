import { toAppTimestamp } from "../timezone";
import { isCanonicalUuid } from "../uuid";

export const ACTIVE_TASK_RETRY_MESSAGE =
  "Assignments changed while saving. Please try again.";

export const ACTIVE_TASK_PRIORITIES = [
  "Low",
  "Medium",
  "High",
  "Critical",
] as const;
export const ACTIVE_TASK_TYPES = ["Deliverable", "LiveOperation"] as const;

export type ActiveTaskPriority = (typeof ACTIVE_TASK_PRIORITIES)[number];
export type ActiveTaskType = (typeof ACTIVE_TASK_TYPES)[number];

export type ActiveTaskDraft = {
  title: string;
  description: string;
  phase: string;
  committeeId: string;
  priority: ActiveTaskPriority;
  taskType: ActiveTaskType;
  dueDate: string;
  dutyDate: string;
  callTime: string;
  endTime: string;
  primaryAssigneeIds: string[];
  isConfidential: boolean;
  allowedViewerIds: string[];
};

export type CreateActiveTaskRequest = ActiveTaskDraft & { eventId: string };
export type EditActiveTaskRequest = ActiveTaskDraft & {
  taskId: string;
  expectedUpdatedAt: string;
};

export type ActiveTaskValidationField =
  | "form"
  | "title"
  | "description"
  | "phase"
  | "committee"
  | "priority"
  | "taskType"
  | "dueDate"
  | "schedule"
  | "primaryAssignees"
  | "confidentiality"
  | "allowedViewers";

export type ActiveTaskValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; field: ActiveTaskValidationField; message: string };

export const ACTIVE_TASK_STALE_MESSAGE =
  "This task changed after you loaded it. Reload and try again.";

const VALIDATION_MESSAGES = {
  generic: "Review the task details and try again.",
  title: "Enter a task title up to 200 characters.",
  description: "Keep the description to 2,000 characters.",
  phase: "Enter a phase up to 100 characters.",
  committee: "Choose an available committee.",
  priority: "Choose a valid priority.",
  taskType: "Choose a valid task type.",
  dueDate: "Choose a valid due date.",
  schedule: "Check the Live Operation date and times.",
  primaryAssignees: "Select up to 100 people.",
  primaryAssigneesInvalid:
    "Check the selected primary assignees and try again.",
  confidentiality: "Check the confidentiality setting.",
  allowedViewers: "Select up to 50 additional viewers.",
  allowedViewersInvalid:
    "Check the selected additional viewers and try again.",
  event: "The event is unavailable.",
  task: "The task is unavailable.",
  token: ACTIVE_TASK_STALE_MESSAGE,
} as const;

type RpcError = { code?: string };
type RpcResponse = { data: unknown; error: RpcError | null };
type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResponse>;
};

export type ActiveTaskRpcFailure = {
  ok: false;
  status: number;
  message: string;
};

export type ActiveTaskRpcSuccess = { ok: true; data: unknown };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;

const COMMON_KEYS = [
  "title",
  "description",
  "phase",
  "committeeId",
  "priority",
  "taskType",
  "dueDate",
  "dutyDate",
  "callTime",
  "endTime",
  "primaryAssigneeIds",
  "isConfidential",
  "allowedViewerIds",
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Object.keys(value);
  return (
    keys.length === expected.length &&
    keys.every((key) => expected.includes(key))
  );
}

function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function validateUuidArray(value: unknown, maximum: number) {
  if (!Array.isArray(value)) return { status: "invalid" as const };
  if (value.length > maximum) return { status: "cap" as const };
  if (
    !value.every(
      (item) => isCanonicalUuid(item),
    )
  ) {
    return { status: "invalid" as const };
  }
  const ids = value as string[];
  const normalizedIds = ids.map((item) => item.toLowerCase());
  return new Set(normalizedIds).size === normalizedIds.length
    ? { status: "valid" as const, ids }
    : { status: "invalid" as const };
}

function invalid(
  field: ActiveTaskValidationField,
  message: string,
): ActiveTaskValidationResult<never> {
  return { ok: false, field, message };
}

function validateCommonTaskDraft(
  body: Record<string, unknown>,
): ActiveTaskValidationResult<ActiveTaskDraft> {
  const title = body.title;
  const description = body.description;
  const phase = body.phase;
  const committeeId = body.committeeId;
  const priority = body.priority;
  const taskType = body.taskType;
  const dueDate = body.dueDate;
  const dutyDate = body.dutyDate;
  const callTime = body.callTime;
  const endTime = body.endTime;
  const primaryAssigneeIds = body.primaryAssigneeIds;
  const isConfidential = body.isConfidential;
  const allowedViewerIds = body.allowedViewerIds;

  if (
    typeof title !== "string" ||
    title.trim().length < 1 ||
    title.trim().length > 200
  ) return invalid("title", VALIDATION_MESSAGES.title);
  if (typeof description !== "string" || description.length > 2000) {
    return invalid("description", VALIDATION_MESSAGES.description);
  }
  if (
    typeof phase !== "string" ||
    phase.trim().length < 1 ||
    phase.trim().length > 100
  ) return invalid("phase", VALIDATION_MESSAGES.phase);
  if (!isCanonicalUuid(committeeId)) {
    return invalid("committee", VALIDATION_MESSAGES.committee);
  }
  if (
    typeof priority !== "string" ||
    !ACTIVE_TASK_PRIORITIES.includes(priority as ActiveTaskPriority)
  ) return invalid("priority", VALIDATION_MESSAGES.priority);
  if (
    typeof taskType !== "string" ||
    !ACTIVE_TASK_TYPES.includes(taskType as ActiveTaskType)
  ) return invalid("taskType", VALIDATION_MESSAGES.taskType);
  if (
    typeof dueDate !== "string" ||
    (dueDate !== "" && !isValidDate(dueDate))
  ) return invalid("dueDate", VALIDATION_MESSAGES.dueDate);
  if (
    typeof dutyDate !== "string" ||
    typeof callTime !== "string" ||
    typeof endTime !== "string"
  ) return invalid("schedule", VALIDATION_MESSAGES.schedule);
  const primaryAssigneeValidation = validateUuidArray(primaryAssigneeIds, 100);
  if (primaryAssigneeValidation.status === "cap") {
    return invalid("primaryAssignees", VALIDATION_MESSAGES.primaryAssignees);
  }
  if (primaryAssigneeValidation.status === "invalid") {
    return invalid(
      "primaryAssignees",
      VALIDATION_MESSAGES.primaryAssigneesInvalid,
    );
  }
  if (typeof isConfidential !== "boolean") {
    return invalid("confidentiality", VALIDATION_MESSAGES.confidentiality);
  }
  const allowedViewerValidation = validateUuidArray(allowedViewerIds, 50);
  if (allowedViewerValidation.status === "cap") {
    return invalid("allowedViewers", VALIDATION_MESSAGES.allowedViewers);
  }
  if (
    allowedViewerValidation.status === "invalid" ||
    (!isConfidential && allowedViewerValidation.ids.length > 0)
  ) {
    return invalid(
      "allowedViewers",
      VALIDATION_MESSAGES.allowedViewersInvalid,
    );
  }

  if (taskType === "Deliverable") {
    if (dutyDate || callTime || endTime) {
      return invalid("schedule", VALIDATION_MESSAGES.schedule);
    }
  } else {
    const hasSchedule = Boolean(dutyDate || callTime || endTime);
    if (
      (hasSchedule && (!isValidDate(dutyDate) || !TIME_PATTERN.test(callTime))) ||
      (endTime !== "" && !TIME_PATTERN.test(endTime)) ||
      (callTime && endTime && endTime < callTime)
    ) {
      return invalid("schedule", VALIDATION_MESSAGES.schedule);
    }
  }

  return { ok: true, data: {
    title: title.trim(),
    description,
    phase: phase.trim(),
    committeeId,
    priority: priority as ActiveTaskPriority,
    taskType: taskType as ActiveTaskType,
    dueDate,
    dutyDate,
    callTime,
    endTime,
    primaryAssigneeIds: primaryAssigneeValidation.ids,
    isConfidential,
    allowedViewerIds: allowedViewerValidation.ids,
  } };
}

export function validateCreateActiveTaskRequest(
  value: unknown,
): ActiveTaskValidationResult<CreateActiveTaskRequest> {
  if (!isPlainRecord(value) || !hasExactKeys(value, ["eventId", ...COMMON_KEYS])) {
    return invalid("form", VALIDATION_MESSAGES.generic);
  }
  if (!isCanonicalUuid(value.eventId)) {
    return invalid("form", VALIDATION_MESSAGES.event);
  }
  const draft = validateCommonTaskDraft(value);
  return draft.ok
    ? { ok: true, data: { eventId: value.eventId, ...draft.data } }
    : draft;
}

export function validateEditActiveTaskRequest(
  value: unknown,
): ActiveTaskValidationResult<EditActiveTaskRequest> {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["taskId", "expectedUpdatedAt", ...COMMON_KEYS])
  ) {
    return invalid("form", VALIDATION_MESSAGES.generic);
  }
  if (!isCanonicalUuid(value.taskId)) {
    return invalid("form", VALIDATION_MESSAGES.task);
  }
  if (
    typeof value.expectedUpdatedAt !== "string" ||
    !TIMESTAMP_PATTERN.test(value.expectedUpdatedAt)
  ) return invalid("form", VALIDATION_MESSAGES.token);
  const draft = validateCommonTaskDraft(value);
  return draft.ok
    ? {
        ok: true,
        data: {
          taskId: value.taskId,
          // This remains the exact database string; never pass it through Date.
          expectedUpdatedAt: value.expectedUpdatedAt,
          ...draft.data,
        },
      }
    : draft;
}

export function parseCreateActiveTaskRequest(
  value: unknown,
): CreateActiveTaskRequest | null {
  const result = validateCreateActiveTaskRequest(value);
  return result.ok ? result.data : null;
}

export function parseEditActiveTaskRequest(
  value: unknown,
): EditActiveTaskRequest | null {
  const result = validateEditActiveTaskRequest(value);
  return result.ok ? result.data : null;
}

function commonRpcArgs(draft: ActiveTaskDraft) {
  return {
    p_title: draft.title,
    p_description: draft.description,
    p_phase: draft.phase,
    p_committee_id: draft.committeeId,
    p_task_type: draft.taskType,
    p_priority: draft.priority,
    // Match Event Create/Edit: preserve yyyy-mm-dd; serialize duty times as PH.
    p_due_date: draft.dueDate || null,
    p_call_time:
      draft.taskType === "LiveOperation"
        ? toAppTimestamp(draft.dutyDate, draft.callTime)
        : null,
    p_end_time:
      draft.taskType === "LiveOperation"
        ? toAppTimestamp(draft.dutyDate, draft.endTime)
        : null,
    p_primary_assignees: draft.primaryAssigneeIds,
    p_is_confidential: draft.isConfidential,
    p_allowed_viewers: draft.isConfidential ? draft.allowedViewerIds : [],
  };
}

export function createActiveTaskRpcArgs(request: CreateActiveTaskRequest) {
  return { p_event_id: request.eventId, ...commonRpcArgs(request) };
}

export function editActiveTaskRpcArgs(request: EditActiveTaskRequest) {
  return {
    p_task_id: request.taskId,
    // Opaque optimistic-concurrency token: do not parse or reserialize.
    p_expected_updated_at: request.expectedUpdatedAt,
    ...commonRpcArgs(request),
  };
}

function mapRpcError(error: RpcError): ActiveTaskRpcFailure {
  if (error.code === "CCS01") {
    return {
      ok: false,
      status: 409,
      message: ACTIVE_TASK_STALE_MESSAGE,
    };
  }
  if (error.code === "CCP01") {
    return {
      ok: false,
      status: 409,
      message: "This event already has the maximum of 200 tasks.",
    };
  }
  if (error.code === "CCN01") {
    return { ok: false, status: 409, message: "No changes to save." };
  }
  if (error.code === "42501") {
    return { ok: false, status: 403, message: "The task is unavailable." };
  }
  if (error.code === "22023") {
    return {
      ok: false,
      status: 400,
      message: "Check the task details and try again.",
    };
  }
  if (error.code === "40001" || error.code === "40P01") {
    return {
      ok: false,
      status: 409,
      message: "The task changed while saving. Refresh and try again.",
    };
  }
  return {
    ok: false,
    status: 500,
    message: "The task could not be saved. Please try again.",
  };
}

export async function runActiveTaskRpc(
  client: RpcClient,
  name: "create_active_event_task" | "edit_active_event_task",
  args: Record<string, unknown>,
): Promise<ActiveTaskRpcFailure | ActiveTaskRpcSuccess> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let response: RpcResponse;
    try {
      // Each call is a distinct PostgREST request and therefore a new DB tx.
      response = await client.rpc(name, args);
    } catch {
      return mapRpcError({});
    }
    if (!response.error) return { ok: true, data: response.data };
    if (response.error.code !== "CCL01") return mapRpcError(response.error);
    if (attempt === 3) {
      return { ok: false, status: 409, message: ACTIVE_TASK_RETRY_MESSAGE };
    }
  }
  return { ok: false, status: 409, message: ACTIVE_TASK_RETRY_MESSAGE };
}

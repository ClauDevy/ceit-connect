import {
  BOARD_PRIORITIES,
  BOARD_STATUSES,
  type BoardAssignee,
  type BoardPriority,
  type BoardStatus,
} from "../events/board";

export type TaskEventStatus = "Draft" | "Active" | "Archived";
export type TaskType = "Deliverable" | "LiveOperation";

export type TaskDetail = {
  id: string;
  event_id: string | null;
  event_name: string | null;
  event_status: TaskEventStatus | null;
  title: string;
  description: string | null;
  phase: string | null;
  status: BoardStatus;
  effective_priority: BoardPriority | null;
  task_type: TaskType | null;
  due_date: string | null;
  call_time: string | null;
  end_time: string | null;
  created_at: string | null;
  updated_at: string | null;
  committee_id: string | null;
  committee_name: string | null;
  primary_assignees: BoardAssignee[];
  assist_assignees: BoardAssignee[];
  is_confidential: boolean | null;
  is_masked: boolean;
  has_dependency: boolean | null;
  is_blocked: boolean | null;
  dependency_label: string | null;
  access_list: BoardAssignee[];
};

const EVENT_STATUSES: TaskEventStatus[] = ["Draft", "Active", "Archived"];
const TASK_TYPES: TaskType[] = ["Deliverable", "LiveOperation"];

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

function isAssignee(value: unknown): value is BoardAssignee {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (typeof row.full_name === "string" || row.full_name === null) &&
    (typeof row.avatar_url === "string" || row.avatar_url === null)
  );
}

function hasAssigneeArray(value: unknown): value is BoardAssignee[] {
  return Array.isArray(value) && value.every(isAssignee);
}

export function isTaskDetail(value: unknown): value is TaskDetail {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;

  if (
    typeof row.id !== "string" ||
    typeof row.title !== "string" ||
    !isNullableString(row.phase) ||
    !BOARD_STATUSES.includes(row.status as BoardStatus) ||
    typeof row.is_masked !== "boolean" ||
    !hasAssigneeArray(row.primary_assignees) ||
    !hasAssigneeArray(row.assist_assignees) ||
    !hasAssigneeArray(row.access_list)
  ) {
    return false;
  }

  if (row.is_masked) {
    return (
      row.title === "Confidential Task" &&
      row.event_id === null &&
      row.event_name === null &&
      row.event_status === null &&
      row.description === null &&
      row.effective_priority === null &&
      row.task_type === null &&
      row.due_date === null &&
      row.call_time === null &&
      row.end_time === null &&
      row.created_at === null &&
      row.updated_at === null &&
      row.committee_id === null &&
      row.committee_name === null &&
      row.primary_assignees.length === 0 &&
      row.assist_assignees.length === 0 &&
      row.is_confidential === null &&
      row.has_dependency === null &&
      row.is_blocked === null &&
      row.dependency_label === null &&
      row.access_list.length === 0
    );
  }

  return (
    typeof row.event_id === "string" &&
    typeof row.event_name === "string" &&
    EVENT_STATUSES.includes(row.event_status as TaskEventStatus) &&
    isNullableString(row.description) &&
    BOARD_PRIORITIES.includes(row.effective_priority as BoardPriority) &&
    TASK_TYPES.includes(row.task_type as TaskType) &&
    isNullableString(row.due_date) &&
    isNullableString(row.call_time) &&
    isNullableString(row.end_time) &&
    typeof row.created_at === "string" &&
    typeof row.updated_at === "string" &&
    typeof row.committee_id === "string" &&
    typeof row.committee_name === "string" &&
    typeof row.is_confidential === "boolean" &&
    typeof row.has_dependency === "boolean" &&
    typeof row.is_blocked === "boolean" &&
    isNullableString(row.dependency_label)
  );
}

export function getTaskBackHref(task: TaskDetail | null) {
  if (!task || task.is_masked || !task.event_id || !task.event_status) {
    return "/home";
  }

  if (task.event_status === "Archived") {
    return `/archives/${task.event_id}`;
  }
  if (task.event_status === "Draft") {
    return `/events/${task.event_id}/edit`;
  }
  return `/events/${task.event_id}`;
}

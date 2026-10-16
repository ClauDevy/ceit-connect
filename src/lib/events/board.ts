export type BoardEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  banner_url: string | null;
};

export type BoardCommittee = { id: string; name: string };

export type BoardPriority = "Low" | "Medium" | "High" | "Critical";
export type BoardStatus = "To Do" | "In Progress" | "Completed";

export type BoardAssignee = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
};

export type BoardTask = {
  id: string;
  title: string;
  phase: string | null;
  status: BoardStatus;
  effective_priority: BoardPriority | null;
  due_date: string | null;
  committee_id: string | null;
  committee_name: string | null;
  primary_assignees: BoardAssignee[];
  assist_assignees: BoardAssignee[];
  is_backlog: boolean;
  is_masked: boolean;
};

export const BOARD_STATUSES: BoardStatus[] = [
  "To Do",
  "In Progress",
  "Completed",
];
export const BOARD_PRIORITIES: BoardPriority[] = [
  "Low",
  "Medium",
  "High",
  "Critical",
];

function isAssignee(value: unknown): value is BoardAssignee {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    (typeof row.full_name === "string" || row.full_name === null) &&
    (typeof row.avatar_url === "string" || row.avatar_url === null)
  );
}

export function isBoardTask(value: unknown): value is BoardTask {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    (typeof row.phase === "string" || row.phase === null) &&
    BOARD_STATUSES.includes(row.status as BoardStatus) &&
    (BOARD_PRIORITIES.includes(row.effective_priority as BoardPriority) ||
      row.effective_priority === null) &&
    (typeof row.due_date === "string" || row.due_date === null) &&
    (typeof row.committee_id === "string" || row.committee_id === null) &&
    (typeof row.committee_name === "string" || row.committee_name === null) &&
    Array.isArray(row.primary_assignees) &&
    row.primary_assignees.every(isAssignee) &&
    Array.isArray(row.assist_assignees) &&
    row.assist_assignees.every(isAssignee) &&
    typeof row.is_backlog === "boolean" &&
    typeof row.is_masked === "boolean"
  );
}

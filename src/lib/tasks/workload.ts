export type TaskAssigneeWorkload = {
  out_id: string;
  out_full_name: string;
  out_committee_id: string | null;
  out_avatar_url: string | null;
  out_active_task_count: number;
};

export function isTaskAssigneeWorkload(
  value: unknown,
): value is TaskAssigneeWorkload {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_id === "string" &&
    typeof row.out_full_name === "string" &&
    (typeof row.out_committee_id === "string" ||
      row.out_committee_id === null) &&
    (typeof row.out_avatar_url === "string" || row.out_avatar_url === null) &&
    typeof row.out_active_task_count === "number" &&
    Number.isInteger(row.out_active_task_count) &&
    row.out_active_task_count >= 0
  );
}

export function workloadCountsByUserId(
  rows: readonly TaskAssigneeWorkload[],
) {
  return new Map(rows.map((row) => [row.out_id, row.out_active_task_count]));
}

export function formatWorkloadLabel(name: string, count: number) {
  return `${name} - ${count} active ${count === 1 ? "task" : "tasks"}`;
}

export function toEventAssigneeOption(row: TaskAssigneeWorkload) {
  return {
    id: row.out_id,
    full_name: row.out_full_name,
    committee_id: row.out_committee_id,
    avatar_url: row.out_avatar_url,
    activeTaskCount: row.out_active_task_count,
  };
}

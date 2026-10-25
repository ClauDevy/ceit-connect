import {
  BOARD_PRIORITIES,
  BOARD_STATUSES,
  type BoardPriority,
  type BoardStatus,
} from "../events/board";
import { LIST_FETCH_LIMIT, LIST_PAGE_SIZE } from "../list-paging";

export const MY_TASKS_PAGE_SIZE = LIST_PAGE_SIZE;

export const MY_TASKS_SORTS = ["deadline", "priority", "event"] as const;

export type MyTasksSort = (typeof MY_TASKS_SORTS)[number];
export type MyTasksStatus = BoardStatus | null;

export type MyTask = {
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
  out_is_primary: boolean;
  out_is_assist: boolean;
  out_request_backup: boolean;
};

type RpcErrorLike = { code?: string };

function isNullableString(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

export function isMyTask(value: unknown): value is MyTask {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.out_id === "string" &&
    typeof row.out_title === "string" &&
    typeof row.out_event_id === "string" &&
    typeof row.out_event_name === "string" &&
    isNullableString(row.out_phase) &&
    BOARD_STATUSES.includes(row.out_status as BoardStatus) &&
    BOARD_PRIORITIES.includes(row.out_effective_priority as BoardPriority) &&
    isNullableString(row.out_due_date) &&
    typeof row.out_committee_id === "string" &&
    typeof row.out_committee_name === "string" &&
    typeof row.out_is_primary === "boolean" &&
    typeof row.out_is_assist === "boolean" &&
    typeof row.out_request_backup === "boolean"
  );
}

export function isMyTasksStatus(value: unknown): value is BoardStatus {
  return BOARD_STATUSES.includes(value as BoardStatus);
}

export function isMyTasksSort(value: unknown): value is MyTasksSort {
  return MY_TASKS_SORTS.includes(value as MyTasksSort);
}

export function getMyTasksRpcArgs(
  status: MyTasksStatus,
  sort: MyTasksSort,
  offset: number,
) {
  return {
    p_status: status,
    p_sort: sort,
    p_limit: LIST_FETCH_LIMIT,
    p_offset: offset,
  };
}

export function dedupeMyTasks(pages: readonly MyTask[][]) {
  const byId = new Map<string, MyTask>();
  for (const task of pages.flat()) byId.set(task.out_id, task);
  return [...byId.values()];
}

export function getLoadedMyTasksCount(tasks: readonly MyTask[]) {
  return tasks.filter((task) => task.out_status !== "Completed").length;
}

export function formatLoadedTaskCount(count: number, hasNextPage: boolean) {
  return `${count}${hasNextPage ? "+" : ""}`;
}

export function getMyTasksErrorMessage(error: unknown) {
  const code =
    error && typeof error === "object"
      ? (error as RpcErrorLike).code
      : undefined;

  if (code === "CCF01") {
    return "Your account is not active. Sign in again or contact an administrator.";
  }
  if (code === "CCF02") {
    return "My Tasks could not load because the page request was invalid.";
  }
  if (code === "CCF03") return "Choose a valid task status.";
  if (code === "CCF04") return "Choose a valid task sort.";
  return "My Tasks could not be loaded. Please try again.";
}

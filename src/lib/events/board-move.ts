import type { BoardStatus, BoardTask } from "@/lib/events/board";
import type { Role } from "@/lib/types";

export const BOARD_POLL_INTERVAL_MS = 15_000;
export const BOARD_UNDO_WINDOW_MS = 8_000;

export type BoardViewer = {
  id: string;
  role: Role;
  committeeId: string | null;
};

export type MovePermission = "none" | "status" | "reorder";

export type NeighborHints = {
  previousNeighborId: string | null;
  nextNeighborId: string | null;
};

export type MoveIntent = NeighborHints & {
  taskId: string;
  phase: string | null;
  expectedStatus: BoardStatus;
  destinationStatus: BoardStatus;
};

export type UndoEntry = {
  taskId: string;
  title: string;
  phase: string | null;
  fromStatus: BoardStatus;
  toStatus: BoardStatus;
  previousNeighborId: string | null;
  nextNeighborId: string | null;
  expiresAt: number;
};

export type MoveErrorKind =
  | "stale"
  | "permission"
  | "dependency"
  | "archived"
  | "offline"
  | "unknown";

export type MoveErrorMessage = {
  kind: MoveErrorKind;
  message: string;
};

export type UndoState = {
  entries: UndoEntry[];
  undoingTaskId: string | null;
};

export type UndoAction =
  | { type: "offer"; entry: UndoEntry }
  | { type: "expire"; taskId: string; expiresAt: number }
  | { type: "undo-start"; taskId: string }
  | { type: "undo-success"; taskId: string }
  | { type: "undo-failure"; taskId: string }
  | { type: "clear"; taskId: string };

function isTaskAssignee(task: BoardTask, viewerId: string) {
  return [...task.primary_assignees, ...task.assist_assignees].some(
    (assignee) => assignee.id === viewerId,
  );
}

export function getMovePermission(
  task: BoardTask,
  viewer: BoardViewer,
): MovePermission {
  if (task.is_masked) return "none";
  if (viewer.role === "Admin") return "reorder";
  if (
    viewer.role === "Co-Admin" &&
    viewer.committeeId !== null &&
    task.committee_id === viewer.committeeId
  ) {
    return "reorder";
  }
  if (viewer.role === "Member" && isTaskAssignee(task, viewer.id)) {
    return "status";
  }
  return "none";
}

export function getBoardRefetchInterval(boardBusy: boolean) {
  return boardBusy ? false : BOARD_POLL_INTERVAL_MS;
}

export function getLaneTasks(
  tasks: readonly BoardTask[],
  phase: string | null,
  status: BoardStatus,
  excludeTaskId?: string,
) {
  return tasks.filter(
    (task) =>
      task.id !== excludeTaskId &&
      task.phase === phase &&
      task.status === status &&
      !task.is_backlog,
  );
}

export function getNeighborHints(
  orderedTaskIds: readonly string[],
  insertionIndex: number,
): NeighborHints {
  const safeIndex = Math.max(0, Math.min(insertionIndex, orderedTaskIds.length));
  return {
    previousNeighborId: safeIndex > 0 ? orderedTaskIds[safeIndex - 1] : null,
    nextNeighborId:
      safeIndex < orderedTaskIds.length ? orderedTaskIds[safeIndex] : null,
  };
}

export function captureTaskNeighbors(
  tasks: readonly BoardTask[],
  taskId: string,
): NeighborHints | null {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.is_backlog) return null;
  const laneIds = getLaneTasks(tasks, task.phase, task.status).map(
    (candidate) => candidate.id,
  );
  const index = laneIds.indexOf(taskId);
  if (index < 0) return null;
  return {
    previousNeighborId: index > 0 ? laneIds[index - 1] : null,
    nextNeighborId: index < laneIds.length - 1 ? laneIds[index + 1] : null,
  };
}

export function createStatusMoveIntent(
  task: BoardTask,
  destinationStatus: BoardStatus,
): MoveIntent | null {
  if (destinationStatus === task.status) return null;
  return {
    taskId: task.id,
    phase: task.phase,
    expectedStatus: task.status,
    destinationStatus,
    previousNeighborId: null,
    nextNeighborId: null,
  };
}

export function createDropMoveIntent({
  tasks,
  taskId,
  destinationStatus,
  overTaskId,
  permission,
}: {
  tasks: readonly BoardTask[];
  taskId: string;
  destinationStatus: BoardStatus;
  overTaskId: string | null;
  permission: MovePermission;
}): MoveIntent | null {
  const task = tasks.find((candidate) => candidate.id === taskId);
  if (!task || task.is_backlog || permission === "none") return null;
  if (permission === "status") {
    return createStatusMoveIntent(task, destinationStatus);
  }

  const destinationLane = getLaneTasks(
    tasks,
    task.phase,
    destinationStatus,
    task.id,
  );
  let insertionIndex = destinationLane.length;

  if (overTaskId) {
    const overTask = tasks.find((candidate) => candidate.id === overTaskId);
    if (
      overTask &&
      !overTask.is_backlog &&
      overTask.phase === task.phase &&
      overTask.status === destinationStatus
    ) {
      if (task.status === destinationStatus) {
        const sourceLane = getLaneTasks(tasks, task.phase, task.status);
        insertionIndex = sourceLane.findIndex(
          (candidate) => candidate.id === overTaskId,
        );
      } else {
        insertionIndex = destinationLane.findIndex(
          (candidate) => candidate.id === overTaskId,
        );
      }
      if (insertionIndex < 0) insertionIndex = destinationLane.length;
    }
  }

  const hints = getNeighborHints(
    destinationLane.map((candidate) => candidate.id),
    insertionIndex,
  );
  const currentNeighbors = captureTaskNeighbors(tasks, task.id);
  if (
    task.status === destinationStatus &&
    currentNeighbors?.previousNeighborId === hints.previousNeighborId &&
    currentNeighbors.nextNeighborId === hints.nextNeighborId
  ) {
    return null;
  }

  return {
    taskId: task.id,
    phase: task.phase,
    expectedStatus: task.status,
    destinationStatus,
    ...hints,
  };
}

export function applyOptimisticMove(
  tasks: readonly BoardTask[],
  intent: MoveIntent,
) {
  const sourceIndex = tasks.findIndex((task) => task.id === intent.taskId);
  if (sourceIndex < 0) return [...tasks];

  const movedTask = {
    ...tasks[sourceIndex],
    status: intent.destinationStatus,
  };
  const remaining = tasks.filter((task) => task.id !== intent.taskId);

  if (intent.nextNeighborId) {
    const nextIndex = remaining.findIndex(
      (task) => task.id === intent.nextNeighborId,
    );
    if (nextIndex >= 0) {
      remaining.splice(nextIndex, 0, movedTask);
      return remaining;
    }
  }

  if (intent.previousNeighborId) {
    const previousIndex = remaining.findIndex(
      (task) => task.id === intent.previousNeighborId,
    );
    if (previousIndex >= 0) {
      remaining.splice(previousIndex + 1, 0, movedTask);
      return remaining;
    }
  }

  const destinationIndexes = remaining.flatMap((task, index) =>
    task.phase === intent.phase &&
    task.status === intent.destinationStatus &&
    !task.is_backlog
      ? [index]
      : [],
  );
  const insertionIndex =
    destinationIndexes.length > 0
      ? destinationIndexes[destinationIndexes.length - 1] + 1
      : Math.min(sourceIndex, remaining.length);
  remaining.splice(insertionIndex, 0, movedTask);
  return remaining;
}

export function createUndoEntry(
  task: BoardTask,
  intent: MoveIntent,
  originalNeighbors: NeighborHints,
  now: number,
): UndoEntry {
  return {
    taskId: task.id,
    title: task.title,
    phase: task.phase,
    fromStatus: intent.expectedStatus,
    toStatus: intent.destinationStatus,
    previousNeighborId: originalNeighbors.previousNeighborId,
    nextNeighborId: originalNeighbors.nextNeighborId,
    expiresAt: now + BOARD_UNDO_WINDOW_MS,
  };
}

export function createUndoIntent(entry: UndoEntry): MoveIntent {
  const sameLane = entry.fromStatus === entry.toStatus;
  return {
    taskId: entry.taskId,
    phase: entry.phase,
    expectedStatus: entry.toStatus,
    destinationStatus: entry.fromStatus,
    previousNeighborId: sameLane ? entry.previousNeighborId : null,
    nextNeighborId: sameLane ? entry.nextNeighborId : null,
  };
}

export function mapMoveError(
  error: unknown,
): MoveErrorMessage {
  const record =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : null;
  const code = typeof record?.code === "string" ? record.code : undefined;
  const message =
    typeof record?.message === "string" ? record.message : "Unknown error";
  if (code === "40001") {
    return {
      kind: "stale",
      message: "The board changed before this move finished. It was refreshed; try again.",
    };
  }
  if (code === "42501") {
    return {
      kind: "permission",
      message: "You no longer have permission to move this task. The board was refreshed.",
    };
  }
  if (message === "Complete the prerequisite task before moving this task forward.") {
    return { kind: "dependency", message };
  }
  if (message === "Tasks in Archived events are read-only.") {
    return { kind: "archived", message };
  }
  if (
    message.toLowerCase().includes("failed to fetch") ||
    message.toLowerCase().includes("network") ||
    (typeof navigator !== "undefined" && navigator.onLine === false)
  ) {
    return {
      kind: "offline",
      message: "The move could not be saved while offline. It was rolled back.",
    };
  }
  return {
    kind: "unknown",
    message: "The task could not be moved. The board was refreshed; try again.",
  };
}

export function undoReducer(state: UndoState, action: UndoAction): UndoState {
  if (action.type === "offer") {
    return {
      ...state,
      entries: [
        ...state.entries.filter((entry) => entry.taskId !== action.entry.taskId),
        action.entry,
      ],
    };
  }
  if (action.type === "expire") {
    return {
      ...state,
      entries: state.entries.filter(
        (entry) =>
          entry.taskId !== action.taskId || entry.expiresAt !== action.expiresAt,
      ),
    };
  }
  if (action.type === "undo-start") {
    return { ...state, undoingTaskId: action.taskId };
  }
  if (action.type === "undo-success" || action.type === "undo-failure") {
    return {
      entries: state.entries.filter((entry) => entry.taskId !== action.taskId),
      undoingTaskId:
        state.undoingTaskId === action.taskId ? null : state.undoingTaskId,
    };
  }
  return {
    ...state,
    entries: state.entries.filter((entry) => entry.taskId !== action.taskId),
  };
}

import {
  BOARD_STATUSES,
  type BoardPriority,
  type BoardStatus,
  type BoardTask,
} from "./board";

export type MobileLaneVisibility = {
  status: BoardStatus;
  intersectionRatio: number;
  centerDistance: number;
};

export function getActiveMobileLane(
  lanes: readonly MobileLaneVisibility[],
  fallback: BoardStatus = "To Do",
) {
  const visible = lanes.filter((lane) => lane.intersectionRatio > 0);
  if (visible.length === 0) return fallback;

  return [...visible].sort((left, right) => {
    const ratioDifference = right.intersectionRatio - left.intersectionRatio;
    if (Math.abs(ratioDifference) > 0.001) return ratioDifference;
    const distanceDifference = left.centerDistance - right.centerDistance;
    if (Math.abs(distanceDifference) > 0.5) return distanceDifference;
    return (
      BOARD_STATUSES.indexOf(left.status) - BOARD_STATUSES.indexOf(right.status)
    );
  })[0].status;
}

export function toggleCollapsedLane(
  collapsed: ReadonlySet<BoardStatus>,
  status: BoardStatus,
) {
  const next = new Set(collapsed);
  if (next.has(status)) next.delete(status);
  else next.add(status);
  return next;
}

export function getAssignedPhaseTasks(
  tasks: readonly BoardTask[],
  selectedPhase: string | null,
  selectedPriorities: ReadonlySet<BoardPriority>,
) {
  return tasks.filter(
    (task) =>
      !task.is_backlog &&
      (task.phase?.trim() || "Unphased") === selectedPhase &&
      (selectedPriorities.size === 0 ||
        task.effective_priority === null ||
        selectedPriorities.has(task.effective_priority)),
  );
}

export function getMobileLanePosition(status: BoardStatus) {
  return BOARD_STATUSES.indexOf(status) + 1;
}

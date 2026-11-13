import { formatDateSafe } from "@/lib/safe-date";
import type { BoardEvent, BoardTask } from "@/lib/events/board";
import {
  canonicalPhaseName,
  isCompletedNamedPhase,
} from "@/lib/tasks/phase-completion";

const eventDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatEventDate(date: string) {
  return formatDateSafe(eventDateFormatter, `${date}T00:00:00Z`);
}

export function getBoardPhaseNames(tasks: readonly BoardTask[]) {
  return Array.from(
    new Set(tasks.map((task) => canonicalPhaseName(task.phase))),
  );
}

export function getCompleteBoardPhases(tasks: readonly BoardTask[]) {
  return new Set(tasks.flatMap((task) =>
    isCompletedNamedPhase(task.phase, task.phaseComplete)
      ? [canonicalPhaseName(task.phase)]
      : []));
}

export function formatEventDateRange(event: BoardEvent) {
  if (!event.end_date || event.end_date === event.start_date) {
    return formatEventDate(event.start_date);
  }
  return `${formatEventDate(event.start_date)} – ${formatEventDate(event.end_date)}`;
}

export function formatTaskCount(count: number) {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

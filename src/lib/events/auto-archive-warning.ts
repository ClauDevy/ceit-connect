export type EventAutoArchiveWarning = {
  daysRemaining: number;
  unfinishedTaskCount: number;
};

export function parseEventAutoArchiveWarning(
  value: unknown,
): EventAutoArchiveWarning | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = value[0];
  if (!row || typeof row !== "object") return null;
  const candidate = row as Record<string, unknown>;
  const daysRemaining = candidate.days_remaining;
  const unfinishedTaskCount = candidate.unfinished_task_count;
  if (
    !Number.isInteger(daysRemaining) ||
    (daysRemaining as number) < 0 ||
    !Number.isSafeInteger(unfinishedTaskCount) ||
    (unfinishedTaskCount as number) < 0
  ) return null;
  return {
    daysRemaining: daysRemaining as number,
    unfinishedTaskCount: unfinishedTaskCount as number,
  };
}

export function formatEventAutoArchiveWarning(
  warning: EventAutoArchiveWarning,
  canExtend: boolean,
) {
  const timing = warning.daysRemaining === 0
    ? "today"
    : `in ${warning.daysRemaining} ${warning.daysRemaining === 1 ? "day" : "days"}`;
  const unfinished = warning.unfinishedTaskCount > 0
    ? ` ${warning.unfinishedTaskCount} ${warning.unfinishedTaskCount === 1 ? "task is" : "tasks are"} unfinished.`
    : "";
  const extension = canExtend
    ? " Edit the event to extend its end date."
    : "";
  return `This event archives automatically ${timing}.${unfinished}${extension}`;
}

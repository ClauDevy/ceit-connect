import type { HomeEvent, HomeEventProgress } from "./list-paging";

export const HOME_EVENT_PROGRESS_RPC = "list_home_event_progress";

export type HomeEventProgressRow = {
  out_event_id: string;
  out_phase_label: string | null;
  out_progress_percentage: number;
  out_visible_backup_request_count: number;
  out_backlog_count: number;
};

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function isHomeEventProgressRow(
  value: unknown,
): value is HomeEventProgressRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<HomeEventProgressRow>;
  return (
    typeof row.out_event_id === "string" &&
    (typeof row.out_phase_label === "string" ||
      row.out_phase_label === null) &&
    isNonnegativeInteger(row.out_progress_percentage) &&
    row.out_progress_percentage <= 100 &&
    isNonnegativeInteger(row.out_visible_backup_request_count) &&
    isNonnegativeInteger(row.out_backlog_count)
  );
}

export function getVisibleActiveEventIds(events: readonly HomeEvent[]) {
  return events
    .slice(0, 20)
    .filter((event) => event.status === "Active")
    .map((event) => event.id);
}

export function parseHomeEventProgressRows(value: unknown) {
  if (!Array.isArray(value) || !value.every(isHomeEventProgressRow)) return null;

  const rows = new Map<string, HomeEventProgress>();
  for (const row of value) {
    if (rows.has(row.out_event_id)) return null;
    rows.set(row.out_event_id, {
      phaseLabel: row.out_phase_label,
      percentage: row.out_progress_percentage,
      visibleBackupRequestCount: row.out_visible_backup_request_count,
      backlogCount: row.out_backlog_count,
    });
  }
  return rows;
}

export function mergeHomeEventProgress(
  events: readonly HomeEvent[],
  value: unknown,
) {
  const rows = parseHomeEventProgressRows(value);
  return events.map((event, index) => {
    if (index >= 20 || event.status !== "Active") return event;
    return { ...event, progress: rows?.get(event.id) ?? null };
  });
}

export function markHomeEventProgressUnavailable(events: readonly HomeEvent[]) {
  return events.map((event, index) =>
    index < 20 && event.status === "Active"
      ? { ...event, progress: null }
      : event,
  );
}

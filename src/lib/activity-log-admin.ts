import {
  ACTIVITY_LOG_EXPORT_MAX_ROWS,
  ACTIVITY_LOG_EXPORT_PAGE_SIZE,
  activityFiltersToRpc,
  normalizeActivityResponse,
  type ActivityCursor,
  type ActivityFilters,
  type ActivityRow,
} from "@/lib/activity-log";

export type ActivityLogRetentionSetting = {
  retentionDays: number;
  updatedAt: string;
  updatedBy: string | null;
};

export function normalizeActivityLogRetentionSetting(
  value: unknown,
): ActivityLogRetentionSetting | null {
  const row = Array.isArray(value) ? value[0] : null;
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  if (
    !Number.isInteger(record.retention_days) ||
    typeof record.updated_at !== "string" ||
    !(record.updated_by === null || typeof record.updated_by === "string")
  ) return null;
  return {
    retentionDays: record.retention_days as number,
    updatedAt: record.updated_at,
    updatedBy: record.updated_by as string | null,
  };
}

export function activityExportRpcArgs(
  filters: ActivityFilters,
  cursor: ActivityCursor | null,
) {
  const args = activityFiltersToRpc(filters, cursor, null, 20);
  return {
    p_sort: args.p_sort,
    p_action: args.p_action,
    p_committee_id: args.p_committee_id,
    p_date_from: args.p_date_from,
    p_date_to: args.p_date_to,
    p_search: args.p_search,
    p_cursor_created_at: args.p_cursor_created_at,
    p_cursor_id: args.p_cursor_id,
    p_page_size: ACTIVITY_LOG_EXPORT_PAGE_SIZE,
  };
}

export function appendExportRows(
  current: readonly ActivityRow[],
  incoming: readonly ActivityRow[],
) {
  const next = [...current];
  const ids = new Set(current.map((row) => row.activityId));
  for (const row of incoming) {
    if (!ids.has(row.activityId)) {
      ids.add(row.activityId);
      next.push(row);
    }
  }
  return next;
}

export function exportLimitExceeded(rowCount: number, hasMore: boolean) {
  return rowCount > ACTIVITY_LOG_EXPORT_MAX_ROWS ||
    (rowCount === ACTIVITY_LOG_EXPORT_MAX_ROWS && hasMore);
}

const DANGEROUS_CSV_PREFIX = /^[=+\-@\t\r]/;

export function escapeActivityCsvCell(value: string | null | undefined) {
  let safe = value ?? "";
  if (DANGEROUS_CSV_PREFIX.test(safe)) safe = `'${safe}`;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function activityRowsToCsv(rows: readonly ActivityRow[]) {
  const header = [
    "Date/time",
    "Action",
    "Task",
    "Event",
    "Committee",
    "Actor",
    "Change summary",
  ];
  const body = rows.map((row) => [
    row.activityCreatedAt,
    row.action,
    row.taskTitle,
    row.eventName,
    row.committeeName,
    row.actorName,
    row.changeSummary?.join("; ") ?? "",
  ]);
  return `\uFEFF${[header, ...body]
    .map((cells) => cells.map(escapeActivityCsvCell).join(","))
    .join("\r\n")}\r\n`;
}

export function normalizeActivityExportPage(value: unknown) {
  return normalizeActivityResponse(value);
}

import { isCanonicalUuid } from "@/lib/uuid";

export const NOTIFICATION_PAGE_SIZE = 20;
export const NOTIFICATION_FETCH_LIMIT = NOTIFICATION_PAGE_SIZE + 1;

export const NOTIFICATION_TYPES = [
  "mention",
  "heads_up",
  "assignment",
  "status_change",
  "unlock",
  "backup_request",
  "volunteer_offer",
  "leave_requested",
  "leave_cancelled",
  "leave_approved",
  "leave_denied",
  "task_due_soon",
  "live_operation_prep",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type NotificationRow = {
  id: string;
  type: NotificationType;
  taskId: string | null;
  commentId: string | null;
  taskTitle: string;
  readAt: string | null;
  createdAt: string;
};

export type NotificationCursor = {
  createdAt: string;
  id: string;
};

export type NotificationPage = {
  items: NotificationRow[];
  hasMore: boolean;
  cursor: NotificationCursor | null;
};

type ParsedPageMetadata = {
  items: NotificationRow[];
  hasMore: boolean;
  cursor: NotificationCursor | null;
};

const parsedPageMetadata = new WeakMap<NotificationRow[], ParsedPageMetadata>();

export type NotificationListState = {
  rows: NotificationRow[];
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  olderPagesLoaded: boolean;
  hasMore: boolean;
  cursor: NotificationCursor | null;
  error: string | null;
  appendError: string | null;
  announcement: string;
};

type RefreshedNotificationListState = Pick<
  NotificationListState,
  "rows" | "hasMore" | "cursor"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isUuid(value: unknown): value is string {
  return isCanonicalUuid(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isNotificationType(value: unknown): value is NotificationType {
  return NOTIFICATION_TYPES.some((type) => type === value);
}

export function parseNotificationUnreadCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function parseMarkNotificationReadResult(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function parseMarkAllNotificationsReadResult(value: unknown) {
  return parseNotificationUnreadCount(value);
}

export function parseDeleteNotificationResult(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function parseClearReadNotificationsResult(value: unknown) {
  return parseNotificationUnreadCount(value);
}

export function parseNotificationRows(value: unknown): NotificationRow[] | null {
  if (!Array.isArray(value) || value.length > NOTIFICATION_FETCH_LIMIT) return null;

  const ids = new Set<string>();
  const rows: NotificationRow[] = [];
  const pageItems: NotificationRow[] = [];
  let rawBoundary: NotificationCursor | null = null;
  for (const [index, candidate] of value.entries()) {
    if (!isRecord(candidate)) return null;
    const {
      out_id: id,
      out_type: type,
      out_task_id: taskId,
      out_comment_id: rawCommentId,
      out_task_title: taskTitle,
      out_read_at: readAt,
      out_created_at: createdAt,
    } = candidate;
    if (!isUuid(id) || ids.has(id) || typeof type !== "string" || !isTimestamp(createdAt)) {
      return null;
    }
    ids.add(id);
    if (index < NOTIFICATION_PAGE_SIZE) {
      rawBoundary = { createdAt, id };
    }
    if (!isNotificationType(type)) continue;
    const commentId = rawCommentId === undefined ? null : rawCommentId;
    if (
      (taskId !== null && !isUuid(taskId)) ||
      (commentId !== null && !isUuid(commentId)) ||
      typeof taskTitle !== "string" ||
      taskTitle.length === 0 ||
      taskTitle.length > 200 ||
      (readAt !== null && !isTimestamp(readAt)) ||
      !isTimestamp(createdAt)
    ) {
      return null;
    }
    const row = { id, type, taskId, commentId, taskTitle, readAt, createdAt };
    rows.push(row);
    if (index < NOTIFICATION_PAGE_SIZE) pageItems.push(row);
  }
  parsedPageMetadata.set(rows, {
    items: pageItems,
    hasMore: value.length > NOTIFICATION_PAGE_SIZE,
    cursor: rawBoundary,
  });
  return rows;
}

export function notificationTargetPath(row: Pick<NotificationRow, "taskId" | "commentId" | "type">) {
  if (!row.taskId) return null;
  if (row.type === "mention" && row.commentId) {
    return `/tasks/${row.taskId}#comment-${row.commentId}`;
  }
  return `/tasks/${row.taskId}`;
}

export function normalizeNotificationPage(
  rows: readonly NotificationRow[],
): NotificationPage {
  const metadata = parsedPageMetadata.get(rows as NotificationRow[]);
  if (metadata) return metadata;

  const items = rows.slice(0, NOTIFICATION_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items,
    hasMore: rows.length > NOTIFICATION_PAGE_SIZE,
    cursor: last ? { createdAt: last.createdAt, id: last.id } : null,
  };
}

export function appendUniqueNotifications(
  current: readonly NotificationRow[],
  incoming: readonly NotificationRow[],
) {
  const seen = new Set(current.map((row) => row.id));
  return [
    ...current,
    ...incoming.filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    }),
  ];
}

export function mergeRefreshedNotificationPage({
  current,
  refreshed,
  olderPagesLoaded,
  currentHasMore,
  currentCursor,
}: {
  current: readonly NotificationRow[];
  refreshed: NotificationPage;
  olderPagesLoaded: boolean;
  currentHasMore: boolean;
  currentCursor: NotificationCursor | null;
}): RefreshedNotificationListState {
  if (!olderPagesLoaded) {
    return {
      rows: [...refreshed.items],
      hasMore: refreshed.hasMore,
      cursor: refreshed.cursor,
    };
  }

  const refreshedIds = new Set(refreshed.items.map((row) => row.id));
  return {
    rows: [
      ...refreshed.items,
      ...current.filter((row) => !refreshedIds.has(row.id)),
    ],
    hasMore: currentHasMore,
    cursor: currentCursor,
  };
}

export function markNotificationRowsRead(
  rows: readonly NotificationRow[],
  notificationId: string | null,
  readAt: string,
) {
  return rows.map((row) =>
    row.readAt === null && (notificationId === null || row.id === notificationId)
      ? { ...row, readAt }
      : row,
  );
}

export function removeNotificationRow(
  rows: readonly NotificationRow[],
  notificationId: string,
) {
  return rows.filter((row) => row.id !== notificationId);
}

export function notificationSentence(row: NotificationRow) {
  switch (row.type) {
    case "mention":
      return `You were mentioned in ${row.taskTitle}.`;
    case "heads_up":
      return `A teammate sent a heads-up on ${row.taskTitle}.`;
    case "assignment":
      return `You were assigned to ${row.taskTitle}.`;
    case "status_change":
      return `The status changed for ${row.taskTitle}.`;
    case "unlock":
      return `${row.taskTitle} is ready to continue.`;
    case "backup_request":
      return `${row.taskTitle} needs backup.`;
    case "volunteer_offer":
      return `${row.taskTitle} has a new volunteer offer.`;
    case "leave_requested":
      return `${row.taskTitle} has a new leave request.`;
    case "leave_cancelled":
      return `A leave request was cancelled for ${row.taskTitle}.`;
    case "leave_approved":
      return `Your leave request for ${row.taskTitle} was approved.`;
    case "leave_denied":
      return `Your leave request for ${row.taskTitle} was denied.`;
    case "task_due_soon":
      return `${row.taskTitle} is due soon.`;
    case "live_operation_prep":
      return `Prepare for ${row.taskTitle}. Call time is soon.`;
  }
}

export function notificationBadgeLabel(count: number | null) {
  if (count === null) return null;
  if (count > 99) return "99+";
  return String(count);
}

export function notificationCountAnnouncement(count: number | null) {
  if (count === null) return "Notification count unavailable.";
  if (count === 0) return "No unread notifications.";
  if (count > 99) return "99 or more unread notifications.";
  return `${count} unread notification${count === 1 ? "" : "s"}.`;
}

export function notificationBellLabel(count: number | null) {
  return count === null
    ? "Notifications, unread count unavailable"
    : `Notifications, ${count > 99 ? "99 or more" : count} unread`;
}

export function formatNotificationRelativeTime(
  value: string,
  now = Date.now(),
) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "Time unavailable";
  const elapsedSeconds = Math.round((timestamp - now) / 1000);
  const absoluteSeconds = Math.abs(elapsedSeconds);
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let divisor = 1;
  if (absoluteSeconds >= 31_536_000) {
    unit = "year";
    divisor = 31_536_000;
  } else if (absoluteSeconds >= 2_592_000) {
    unit = "month";
    divisor = 2_592_000;
  } else if (absoluteSeconds >= 604_800) {
    unit = "week";
    divisor = 604_800;
  } else if (absoluteSeconds >= 86_400) {
    unit = "day";
    divisor = 86_400;
  } else if (absoluteSeconds >= 3_600) {
    unit = "hour";
    divisor = 3_600;
  } else if (absoluteSeconds >= 60) {
    unit = "minute";
    divisor = 60;
  }
  return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(
    Math.round(elapsedSeconds / divisor),
    unit,
  );
}

export function isModifiedNotificationActivation({
  button,
  ctrlKey,
  metaKey,
  shiftKey,
}: {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return button === 1 || ctrlKey || metaKey || shiftKey;
}

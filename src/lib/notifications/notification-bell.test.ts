import { describe, expect, it } from "vitest";
import {
  appendUniqueNotifications,
  formatNotificationRelativeTime,
  isModifiedNotificationActivation,
  markNotificationRowsRead,
  mergeRefreshedNotificationPage,
  normalizeNotificationPage,
  notificationBadgeLabel,
  notificationBellLabel,
  notificationCountAnnouncement,
  notificationSentence,
  parseMarkAllNotificationsReadResult,
  parseMarkNotificationReadResult,
  parseNotificationRows,
  parseNotificationUnreadCount,
  type NotificationRow,
} from "./notification-bell";

const ids = Array.from(
  { length: 30 },
  (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
);

function row(index: number, overrides: Partial<NotificationRow> = {}): NotificationRow {
  return {
    id: ids[index],
    type: "mention",
    taskId: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    taskTitle: `Task ${index + 1}`,
    readAt: null,
    createdAt: new Date(Date.UTC(2026, 10, 9, 12, 0, 30 - index)).toISOString(),
    ...overrides,
  };
}

function rpcRow(value: NotificationRow) {
  return {
    out_id: value.id,
    out_type: value.type,
    out_task_id: value.taskId,
    out_task_title: value.taskTitle,
    out_read_at: value.readAt,
    out_created_at: value.createdAt,
  };
}

describe("notification bell response contracts", () => {
  it("accepts only the observed numeric bigint representation for counts", () => {
    expect(parseNotificationUnreadCount(0)).toBe(0);
    expect(parseNotificationUnreadCount(101)).toBe(101);
    expect(parseNotificationUnreadCount("101")).toBeNull();
    expect(parseNotificationUnreadCount(-1)).toBeNull();
    expect(parseNotificationUnreadCount(1.5)).toBeNull();
  });

  it("validates the two writer response shapes", () => {
    expect(parseMarkNotificationReadResult(true)).toBe(true);
    expect(parseMarkNotificationReadResult(false)).toBe(false);
    expect(parseMarkNotificationReadResult(1)).toBeNull();
    expect(parseMarkAllNotificationsReadResult(4)).toBe(4);
    expect(parseMarkAllNotificationsReadResult("4")).toBeNull();
  });

  it("strictly parses all six list types, nullable task ids, and timestamps", () => {
    const types = [
      "mention",
      "heads_up",
      "assignment",
      "status_change",
      "unlock",
      "backup_request",
    ] as const;
    const value = types.map((type, index) =>
      rpcRow(row(index, { type, taskId: index === 5 ? null : row(index).taskId })),
    );
    expect(parseNotificationRows(value)?.map((item) => item.type)).toEqual(types);
    expect(parseNotificationRows(value)?.at(-1)?.taskId).toBeNull();
    expect(parseNotificationRows([{ ...value[0], out_type: "unknown" }])).toBeNull();
    expect(parseNotificationRows([{ ...value[0], out_created_at: "bad" }])).toBeNull();
    expect(parseNotificationRows([value[0], value[0]])).toBeNull();
  });
});

describe("notification paging and settlement", () => {
  it("fetches 21, shows 20, and uses the twentieth row as the cursor", () => {
    const page = normalizeNotificationPage(Array.from({ length: 21 }, (_, i) => row(i)));
    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toEqual({ createdAt: row(19).createdAt, id: row(19).id });
    expect(page.items.some((item) => item.id === row(20).id)).toBe(false);
  });

  it("deduplicates appended pages without disturbing existing order", () => {
    expect(appendUniqueNotifications([row(0), row(1)], [row(1), row(2)]).map((item) => item.id)).toEqual([
      row(0).id,
      row(1).id,
      row(2).id,
    ]);
  });

  it("merges a refreshed first page while retaining older loaded rows and cursor", () => {
    const current = [row(1), row(2), row(20)];
    const refreshed = normalizeNotificationPage([
      row(0),
      row(1, { taskTitle: "Updated" }),
    ]);
    const merged = mergeRefreshedNotificationPage({
      current,
      refreshed,
      olderPagesLoaded: true,
      currentHasMore: true,
      currentCursor: { createdAt: row(20).createdAt, id: row(20).id },
    });
    expect(merged.items.map((item) => item.id)).toEqual([
      row(0).id,
      row(1).id,
      row(2).id,
      row(20).id,
    ]);
    expect(merged.items[1].taskTitle).toBe("Updated");
    expect(merged.cursor?.id).toBe(row(20).id);
  });

  it("resets the cursor only when no older page has been loaded", () => {
    const refreshed = normalizeNotificationPage([row(0), row(1)]);
    expect(
      mergeRefreshedNotificationPage({
        current: [row(2)],
        refreshed,
        olderPagesLoaded: false,
        currentHasMore: true,
        currentCursor: { createdAt: row(2).createdAt, id: row(2).id },
      }),
    ).toEqual({ items: refreshed.items, hasMore: false, cursor: refreshed.cursor });
  });

  it("updates loaded display rows only after a confirmed writer result", () => {
    const current = [row(0), row(1), row(2, { readAt: "2026-11-09T13:00:00Z" })];
    const one = markNotificationRowsRead(current, row(1).id, "2026-11-09T14:00:00Z");
    expect(one.map((item) => item.readAt)).toEqual([
      null,
      "2026-11-09T14:00:00Z",
      "2026-11-09T13:00:00Z",
    ]);
    expect(markNotificationRowsRead(one, null, "2026-11-09T15:00:00Z")[0].readAt).toBe(
      "2026-11-09T15:00:00Z",
    );
  });
});

describe("notification presentation", () => {
  it.each([
    ["mention", "You were mentioned in Task 1."],
    ["heads_up", "A teammate sent a heads-up on Task 1."],
    ["assignment", "You were assigned to Task 1."],
    ["status_change", "The status changed for Task 1."],
    ["unlock", "Task 1 is ready to continue."],
    ["backup_request", "Task 1 needs backup."],
  ] as const)("formats %s with reader-returned text only", (type, expected) => {
    expect(notificationSentence(row(0, { type }))).toBe(expected);
    expect(notificationSentence(row(0, { type, taskTitle: "Confidential Task" }))).toContain(
      "Confidential Task",
    );
  });

  it("caps only the visual badge and announces the full accessible meaning", () => {
    expect(notificationBadgeLabel(100)).toBe("99+");
    expect(notificationCountAnnouncement(100)).toBe("99 or more unread notifications.");
    expect(notificationBellLabel(100)).toBe("Notifications, 99 or more unread");
  });

  it("formats relative time from the render-time value without a ticking clock", () => {
    const now = Date.UTC(2026, 10, 9, 12, 0, 0);
    expect(formatNotificationRelativeTime("2026-11-09T11:55:00Z", now)).toBe("5 minutes ago");
  });

  it.each([
    [{ button: 0, ctrlKey: true, metaKey: false, shiftKey: false }, true],
    [{ button: 0, ctrlKey: false, metaKey: true, shiftKey: false }, true],
    [{ button: 0, ctrlKey: false, metaKey: false, shiftKey: true }, true],
    [{ button: 1, ctrlKey: false, metaKey: false, shiftKey: false }, true],
    [{ button: 0, ctrlKey: false, metaKey: false, shiftKey: false }, false],
  ])("classifies native modified activation", (event, expected) => {
    expect(isModifiedNotificationActivation(event)).toBe(expected);
  });
});

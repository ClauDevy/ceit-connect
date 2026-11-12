import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  mergeRefreshedNotificationPage,
  normalizeNotificationPage,
  parseNotificationRows,
  type NotificationListState,
} from "@/lib/notifications/notification-bell";
import { NotificationRowsView } from "./notification-center";

const EMPTY_LIST: NotificationListState = {
  rows: [],
  loaded: false,
  loading: false,
  loadingMore: false,
  olderPagesLoaded: false,
  hasMore: false,
  cursor: null,
  error: null,
  appendError: null,
  announcement: "",
};

const PROD_ROW = {
  out_id: "10000000-0000-4000-8000-000000000001",
  out_type: "mention",
  out_task_id: "20000000-0000-4000-8000-000000000001",
  out_task_title: "Orientation",
  out_read_at: "2026-11-08T18:05:28.933426+00:00",
  out_created_at: "2026-11-08T09:16:52.532708+00:00",
};

function renderRows({
  count,
  countError = null,
  list,
}: {
  count: number | null;
  countError?: string | null;
  list: NotificationListState;
}) {
  return renderToStaticMarkup(
    <NotificationRowsView
      count={count}
      countError={countError}
      list={list}
      busyIds={new Set()}
      close={vi.fn()}
      markOne={vi.fn().mockResolvedValue(true)}
      deleteOne={vi.fn().mockResolvedValue(true)}
      refreshList={vi.fn()}
      navigate={vi.fn()}
    />,
  );
}

describe("notification center rendered list", () => {
  it("renders a successful Prod-shaped response instead of the empty state", () => {
    const rows = parseNotificationRows([PROD_ROW]);
    expect(rows).not.toBeNull();
    const refreshed = normalizeNotificationPage(rows!);
    const merged = mergeRefreshedNotificationPage({
      current: [],
      refreshed,
      olderPagesLoaded: false,
      currentHasMore: false,
      currentCursor: null,
    });
    const markup = renderRows({
      count: 0,
      list: { ...EMPTY_LIST, ...merged, loaded: true },
    });

    expect(markup).toContain("You were mentioned in Orientation.");
    expect(markup).not.toContain("No notifications yet");
  });

  it("renders request notification copy from the reader-returned safe title", () => {
    const rows = parseNotificationRows([{ ...PROD_ROW, out_type: "leave_approved" }]);
    expect(rows).not.toBeNull();
    const refreshed = normalizeNotificationPage(rows!);
    const merged = mergeRefreshedNotificationPage({
      current: [],
      refreshed,
      olderPagesLoaded: false,
      currentHasMore: false,
      currentCursor: null,
    });
    const markup = renderRows({
      count: 1,
      list: { ...EMPTY_LIST, ...merged, loaded: true },
    });

    expect(markup).toContain("Your leave request for Orientation was approved.");
  });

  it.each([
    ["task_due_soon", "Orientation is due soon."],
    ["live_operation_prep", "Prepare for Orientation. Call time is soon."],
  ])("renders %s reminder copy from the reader-returned safe title", (type, copy) => {
    const rows = parseNotificationRows([{ ...PROD_ROW, out_type: type }]);
    expect(rows).not.toBeNull();
    const refreshed = normalizeNotificationPage(rows!);
    const merged = mergeRefreshedNotificationPage({
      current: [],
      refreshed,
      olderPagesLoaded: false,
      currentHasMore: false,
      currentCursor: null,
    });
    const markup = renderRows({
      count: 1,
      list: { ...EMPTY_LIST, ...merged, loaded: true },
    });

    expect(markup).toContain(copy);
  });

  it("never claims the list is empty while count is positive, refreshing, or errored", () => {
    const positive = renderRows({
      count: 1,
      list: { ...EMPTY_LIST, loaded: true },
    });
    expect(positive).toContain("Notifications could not be displayed");
    expect(positive).toContain("Refresh");
    expect(positive).not.toContain("No notifications yet");

    const countErrored = renderRows({
      count: 1,
      countError: "Count failed.",
      list: { ...EMPTY_LIST, loaded: true },
    });
    expect(countErrored).toContain("Notifications could not be displayed");
    expect(countErrored).toContain("Refresh");
    expect(countErrored).not.toContain("No notifications yet");

    const unknownCount = renderRows({
      count: null,
      countError: "Count failed.",
      list: { ...EMPTY_LIST, loaded: true },
    });
    expect(unknownCount).toContain("Notifications could not be displayed");
    expect(unknownCount).toContain("Refresh");
    expect(unknownCount).not.toContain("No notifications yet");

    const refreshing = renderRows({
      count: 0,
      list: { ...EMPTY_LIST, loaded: true, loading: true },
    });
    expect(refreshing).toContain("Loading notifications");
    expect(refreshing).not.toContain("No notifications yet");

    const errored = renderRows({
      count: 0,
      list: { ...EMPTY_LIST, loaded: true, error: "List failed." },
    });
    expect(errored).not.toContain("No notifications yet");
    expect(errored).not.toContain("Notifications could not be displayed");

    for (const count of [0, 1]) {
      const firstLoadError = renderRows({
        count,
        list: { ...EMPTY_LIST, error: "List failed." },
      });
      expect(firstLoadError).not.toContain("Loading notifications");
      expect(firstLoadError).not.toContain("No notifications yet");
      expect(firstLoadError).not.toContain("Notifications could not be displayed");
    }
  });
});

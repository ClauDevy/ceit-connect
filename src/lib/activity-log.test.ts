import { describe, expect, it } from "vitest";
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ACTION_PRESENTATION,
  ACTIVITY_PREFETCH_PAGES,
  ACTIVITY_SORT_LABELS,
  DEFAULT_ACTIVITY_FILTERS,
  GLOBAL_ACTIVITY_LOG_PAGE_SIZE,
  addKnownActivityCursor,
  activityActorInitials,
  activityBlockArrowTargets,
  activityCursorStackToPage,
  activityCursorForPage,
  activityFiltersToRpc,
  activityCommitteeLabels,
  activityLogQueryKey,
  activityMotionKeys,
  activityMotionState,
  activityOpenTaskHref,
  activityPageBlock,
  activityPagerSlots,
  activityPagerState,
  activityReplayDepth,
  activityWindowFromPage,
  appendActivityPage,
  canPrefetchActivityPage,
  createActivityPrefetchController,
  shouldStartActivityPrefetch,
  taskHistoryOlderPageFailure,
  globalActivityLogQueryKey,
  isCanonicalUuid,
  normalizeActivityResponse,
  normalizeActivitySearch,
  activityErrorMessage,
  popActivityCursor,
  prefetchActivityPageChain,
  pushActivityCursor,
  replayActivityPages,
  resetActivityCursorStack,
  validateActivityFilters,
  visibleActivityPageNumbers,
  type ActivityPage,
  type ActivityCursorStack,
  type ActivityRow,
} from "./activity-log";

const id1 = "01890f3e-7b2c-7cc1-9234-0123456789ab";
const id2 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const id3 = "01890f3e-7b2c-7cc1-9234-0123456789ac";
const cursor = "2026-10-29T12:00:00.123456+00:00";
const row = (id: string): ActivityRow => ({
  activityId: id, activityCreatedAt: cursor, action: "INSERT", taskId: null,
  taskTitle: "Task", eventName: null, committeeId: null, committeeName: null,
  actorName: null, changeSummary: ["Task created"], isMasked: false,
});
const page = (rows: ActivityRow[], hasMore = false): ActivityPage => ({
  rows, hasMore, cursor: hasMore ? { createdAt: cursor, id: rows.at(-1)?.activityId ?? id1 } : null,
});

describe("activity log helpers", () => {
  it("accepts canonical UUIDv7 and UUIDv1 values", () => {
    expect(isCanonicalUuid(id1)).toBe(true);
    expect(isCanonicalUuid(id2)).toBe(true);
  });

  it("trims search, maps empty search to null, and preserves exact cursors", () => {
    expect(normalizeActivitySearch("  hello  ")).toEqual({ value: "hello", error: null });
    expect(activityFiltersToRpc({ ...DEFAULT_ACTIVITY_FILTERS, search: "   " }, { createdAt: cursor, id: id1 }, null)).toMatchObject({
      p_search: null, p_cursor_created_at: cursor, p_cursor_id: id1,
    });
  });

  it("maps default and filtered yyyy-mm-dd values to RPC arguments", () => {
    expect(activityFiltersToRpc(DEFAULT_ACTIVITY_FILTERS, null, null)).toEqual({
      p_task_id: null, p_sort: "newest", p_action: null,
      p_committee_id: null, p_date_from: null, p_date_to: null,
      p_search: null, p_cursor_created_at: null, p_cursor_id: null,
      p_page_size: 20,
    });
    expect(activityFiltersToRpc({
      sort: "oldest", action: "DELETE", committeeId: id2,
      dateFrom: "2026-10-01", dateTo: "2026-10-29", search: "  audit  ",
    }, null, id1)).toMatchObject({
      p_task_id: id1, p_sort: "oldest", p_action: "DELETE",
      p_committee_id: id2, p_date_from: "2026-10-01",
      p_date_to: "2026-10-29", p_search: "audit",
    });
  });

  it("keeps Task History task scope and its 20-row page size unchanged", () => {
    expect(activityFiltersToRpc(DEFAULT_ACTIVITY_FILTERS, null, id1)).toMatchObject({
      p_task_id: id1,
      p_sort: "newest",
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_page_size: 20,
    });
  });

  it("rejects overlong search and reversed dates before an RPC", () => {
    expect(normalizeActivitySearch("x".repeat(101)).error).toBe("The activity log request is invalid.");
    expect(validateActivityFilters({ ...DEFAULT_ACTIVITY_FILTERS, dateFrom: "2026-10-30", dateTo: "2026-10-29" })).toBe("The activity log request is invalid.");
  });

  it("uses every filter in the query key so stale responses stay isolated", () => {
    const base = activityLogQueryKey({ taskId: null }, DEFAULT_ACTIVITY_FILTERS);
    const changed = activityLogQueryKey({ taskId: null }, { ...DEFAULT_ACTIVITY_FILTERS, action: "UPDATE" });
    expect(changed).not.toEqual(base);
  });

  it("removes sentinel rows but retains their exact cursor", () => {
    expect(normalizeActivityResponse([{ activity_id: null, activity_created_at: null, action: null, task_id: null, task_title: null, event_name: null, committee_id: null, committee_name: null, actor_name: null, change_summary: null, is_masked: null, has_more: true, next_cursor_created_at: cursor, next_cursor_id: id1 }])).toEqual({
      rows: [], hasMore: true, cursor: { createdAt: cursor, id: id1 },
    });
  });

  it("normalizes the exact minimal masked-row shape", () => {
    const normalized = normalizeActivityResponse([{
      activity_id: id1, activity_created_at: cursor, action: "UPDATE",
      task_id: null, task_title: "Confidential Task", event_name: null,
      committee_id: null, committee_name: null, actor_name: null,
      change_summary: null, is_masked: true, has_more: false,
      next_cursor_created_at: null, next_cursor_id: null,
    }]);
    expect(normalized.rows[0]).toEqual({
      activityId: id1, activityCreatedAt: cursor, action: "UPDATE",
      taskId: null, taskTitle: "Confidential Task", eventName: null,
      committeeId: null, committeeName: null, actorName: null,
      changeSummary: null, isMasked: true,
    });
  });

  it("rejects an unknown-typed invalid action during normalization", () => {
    const invalidAction: unknown = "UPSERT";
    expect(() => normalizeActivityResponse([{
      activity_id: id1, activity_created_at: cursor, action: invalidAction,
      task_id: null, task_title: "Task", event_name: null,
      committee_id: null, committee_name: null, actor_name: null,
      change_summary: null, is_masked: false, has_more: false,
      next_cursor_created_at: null, next_cursor_id: null,
    }])).toThrow("The activity log returned an invalid response.");
  });

  it("provides safe Select labels for every sort and action value", () => {
    expect(ACTIVITY_SORT_LABELS).toEqual({ newest: "Newest first", oldest: "Oldest first" });
    expect(ACTIVITY_ACTION_LABELS).toEqual({ INSERT: "Created", UPDATE: "Updated", DELETE: "Deleted" });
    const committeeLabels = activityCommitteeLabels([
      { id: id1, name: "Committee A" }, { id: id2, name: "Committee B" },
    ]);
    expect(committeeLabels.all).toBe("All committees");
    expect(committeeLabels[id2]).toBe("Committee B");
  });

  it("maps every action to its semantic variant, label, and icon", () => {
    expect(ACTIVITY_ACTION_PRESENTATION).toEqual({
      INSERT: { label: "Created", variant: "success", icon: "plus" },
      UPDATE: { label: "Updated", variant: "brand", icon: "pencil" },
      DELETE: { label: "Deleted", variant: "destructive", icon: "trash" },
    });
  });

  it("pushes and pops exact cursor strings and trims to a visited page", () => {
    const first = resetActivityCursorStack();
    const second = pushActivityCursor(first, { createdAt: cursor, id: id1 });
    const third = pushActivityCursor(second, {
      createdAt: "2026-10-29T12:00:00.123457+00:00",
      id: id2,
    });
    expect(third[1]).toEqual({ createdAt: cursor, id: id1 });
    expect(popActivityCursor(third)).toEqual(second);
    expect(activityCursorStackToPage(third, 1)).toEqual([null]);
  });

  it("shows at most three visited page numbers ending at the active page", () => {
    expect(visibleActivityPageNumbers(2)).toEqual([1, 2]);
    expect(visibleActivityPageNumbers(5)).toEqual([3, 4, 5]);
  });

  it("derives Previous, Next, and visibility only from page and has_more", () => {
    expect(activityPagerState(1, false)).toEqual({
      show: false, canPrevious: false, canNext: false,
    });
    expect(activityPagerState(1, true)).toEqual({
      show: true, canPrevious: false, canNext: true,
    });
    expect(activityPagerState(2, false)).toEqual({
      show: true, canPrevious: true, canNext: false,
    });
  });

  it("keeps Next available for an empty sentinel page with has_more", () => {
    const sentinel = normalizeActivityResponse([{
      activity_id: null, activity_created_at: null, action: null,
      task_id: null, task_title: null, event_name: null,
      committee_id: null, committee_name: null, actor_name: null,
      change_summary: null, is_masked: null, has_more: true,
      next_cursor_created_at: cursor, next_cursor_id: id1,
    }]);
    expect(sentinel.rows).toEqual([]);
    expect(activityPagerState(1, sentinel.hasMore).canNext).toBe(true);
  });

  it("resets filters to page one and isolates exact cursor query keys", () => {
    expect(resetActivityCursorStack()).toEqual([null]);
    expect(globalActivityLogQueryKey(DEFAULT_ACTIVITY_FILTERS, null)).not.toEqual(
      globalActivityLogQueryKey(DEFAULT_ACTIVITY_FILTERS, {
        createdAt: cursor,
        id: id1,
      }),
    );
    expect(activityFiltersToRpc(
      DEFAULT_ACTIVITY_FILTERS,
      null,
      null,
      GLOBAL_ACTIVITY_LOG_PAGE_SIZE,
    ).p_page_size).toBe(20);
  });

  it("shows only known pages in three-page blocks", () => {
    expect(activityPageBlock(1, 2)).toEqual([1, 2]);
    expect(activityPageBlock(1, 3)).toEqual([1, 2, 3]);
    expect(activityPageBlock(4, 6)).toEqual([4, 5, 6]);
    expect(activityPageBlock(4, 4)).toEqual([4]);
  });

  it("targets the first page of adjacent blocks without guessing cursors", () => {
    expect(activityBlockArrowTargets(1)).toEqual({ previous: null, next: 4 });
    expect(activityBlockArrowTargets(4)).toEqual({ previous: 1, next: 7 });
    const known = addKnownActivityCursor(
      resetActivityCursorStack(),
      2,
      { createdAt: cursor, id: id1 },
    );
    expect(activityCursorForPage(known, 2)).toEqual({ createdAt: cursor, id: id1 });
    expect(activityCursorForPage(known, 3)).toBeUndefined();
  });

  it("prefetches only visible has_more pages and at most two ahead", () => {
    expect(ACTIVITY_PREFETCH_PAGES).toBe(2);
    expect(canPrefetchActivityPage(true, 0, true)).toBe(true);
    expect(canPrefetchActivityPage(true, 1, true)).toBe(true);
    expect(canPrefetchActivityPage(true, 2, true)).toBe(false);
    expect(canPrefetchActivityPage(false, 0, true)).toBe(false);
    expect(canPrefetchActivityPage(true, 0, false)).toBe(false);
  });

  it("starts the prefetch chain from server-provided initial default data", () => {
    expect(shouldStartActivityPrefetch({
      activePage: 1,
      filters: DEFAULT_ACTIVITY_FILTERS,
      hasMore: true,
      cursor: { createdAt: cursor, id: id1 },
      tabVisible: true,
      source: "initial",
    })).toBe(true);
  });

  it("prefetches two pages from initial data, registers every cursor, and cancels on filter reset", async () => {
    const c2 = { createdAt: "2026-10-29T12:00:00.000002+00:00", id: id1 };
    const c3 = { createdAt: "2026-10-29T12:00:00.000003+00:00", id: id2 };
    const c4 = { createdAt: "2026-10-29T12:00:00.000004+00:00", id: id3 };
    const pages = new Map([
      [c2.createdAt, { hasMore: true, cursor: c3, unavailable: false }],
      [c3.createdAt, { hasMore: true, cursor: c4, unavailable: false }],
    ]);
    const fetched: string[] = [];
    const result = await prefetchActivityPageChain({
      initialPage: { hasMore: true, cursor: c2, unavailable: false },
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async (pageCursor) => {
        fetched.push(pageCursor.createdAt);
        const page = pages.get(pageCursor.createdAt);
        if (!page) throw new Error("unexpected prefetch");
        return page;
      },
      isCancelled: () => false,
    });
    expect(fetched).toEqual([c2.createdAt, c3.createdAt]);
    expect(result.prefetchCount).toBe(2);
    expect(activityPageBlock(1, result.knownCursors.length)).toEqual([1, 2, 3]);
    expect(activityCursorForPage(result.knownCursors, 4)).toEqual(c4);

    let cancelled = false;
    const cancelledResult = await prefetchActivityPageChain({
      initialPage: { hasMore: true, cursor: c2, unavailable: false },
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => {
        cancelled = true;
        return { hasMore: true, cursor: c3, unavailable: false };
      },
      isCancelled: () => cancelled,
    });
    expect(cancelledResult).toEqual({
      cancelled: true,
      knownCursors: resetActivityCursorStack(),
      prefetchCount: 1,
    });
  });

  it("restarts the full prefetch chain after Strict Mode cleanup", async () => {
    const c2 = { createdAt: "2026-10-29T12:00:00.000002+00:00", id: id1 };
    const c3 = { createdAt: "2026-10-29T12:00:00.000003+00:00", id: id2 };
    const c4 = { createdAt: "2026-10-29T12:00:00.000004+00:00", id: id3 };
    const controller = createActivityPrefetchController();
    const writes: ActivityCursorStack[] = [];
    let releaseFirst!: (page: { hasMore: boolean; cursor: typeof c3; unavailable: boolean }) => void;
    const firstGate = new Promise<{ hasMore: boolean; cursor: typeof c3; unavailable: boolean }>((resolve) => {
      releaseFirst = resolve;
    });

    async function run(fetchPage: (pageCursor: typeof c2) => Promise<{ hasMore: boolean; cursor: typeof c3 | typeof c4; unavailable: boolean }>) {
      const chainId = controller.start();
      const result = await prefetchActivityPageChain({
        initialPage: { hasMore: true, cursor: c2, unavailable: false },
        initialPageNumber: 1,
        knownCursors: resetActivityCursorStack(),
        fetchPage,
        isCancelled: () => controller.currentChainId() !== chainId,
      });
      if (!result.cancelled && controller.currentChainId() === chainId) {
        writes.push(result.knownCursors);
      }
      return result;
    }

    const cancelledRun = run(async () => firstGate);
    await Promise.resolve();
    controller.cancel();

    const secondFetches: string[] = [];
    const restartedRun = run(async (pageCursor) => {
      secondFetches.push(pageCursor.createdAt);
      return pageCursor.createdAt === c2.createdAt
        ? { hasMore: true, cursor: c3, unavailable: false }
        : { hasMore: true, cursor: c4, unavailable: false };
    });
    const restarted = await restartedRun;
    releaseFirst({ hasMore: true, cursor: c3, unavailable: false });
    await cancelledRun;

    expect(secondFetches).toEqual([c2.createdAt, c3.createdAt]);
    expect(restarted.prefetchCount).toBe(2);
    expect(activityPageBlock(1, restarted.knownCursors.length)).toEqual([1, 2, 3]);
    expect(activityCursorForPage(restarted.knownCursors, 4)).toEqual(c4);
    expect(writes).toEqual([restarted.knownCursors]);
  });

  it("cancels and restarts the prefetch lifecycle after a filter change", () => {
    const controller = createActivityPrefetchController();
    const first = controller.start();
    controller.cancel();
    const filtered = controller.start();
    expect(filtered).not.toBe(first);
    expect(controller.currentChainId()).toBe(filtered);
  });

  it("gives rendered page and placeholder slots unique prefixed keys", () => {
    const slots = activityPagerSlots([1, 2]);
    expect(slots).toEqual([
      { key: "page-1", page: 1 },
      { key: "page-2", page: 2 },
      { key: "slot-2", page: null },
    ]);
    expect(new Set(slots.map((slot) => slot.key)).size).toBe(slots.length);
  });

  it("drops known cursor pages when filters reset", () => {
    const known = addKnownActivityCursor(
      resetActivityCursorStack(),
      2,
      { createdAt: cursor, id: id1 },
    );
    expect(known).toHaveLength(2);
    expect(resetActivityCursorStack()).toEqual([null]);
  });

  it("builds Open task links only for valid visible non-delete rows", () => {
    expect(activityOpenTaskHref({ taskId: id1, isMasked: false, action: "UPDATE" }))
      .toBe(`/tasks/${id1}`);
    expect(activityOpenTaskHref({ taskId: id2, isMasked: false, action: "INSERT" }))
      .toBe(`/tasks/${id2}`);
    expect(activityOpenTaskHref({ taskId: "not-a-uuid", isMasked: false, action: "UPDATE" }))
      .toBeNull();
    expect(activityOpenTaskHref({ taskId: id1, isMasked: true, action: "UPDATE" }))
      .toBeNull();
    expect(activityOpenTaskHref({ taskId: id1, isMasked: false, action: "DELETE" }))
      .toBeNull();
  });

  it("derives actor initials by Unicode code points", () => {
    expect(activityActorInitials("Álvaro Núñez")).toBe("ÁN");
    expect(activityActorInitials("🐯Tiger")).toBe("🐯T");
    expect(activityActorInitials("李")).toBe("李");
    expect(activityActorInitials(null)).toBeNull();
  });

  it("maps CAL02 to fixed text without echoing the rejected value", () => {
    const message = activityErrorMessage({ code: "CAL02", message: "sideways" });
    expect(message).toBe("Activity history could not be loaded.");
    expect(message).not.toContain("sideways");
  });

  it("maps older task-history failures without exposing database text", () => {
    const failure = taskHistoryOlderPageFailure({
      code: "XX001",
      message: "secret rejected value",
    });
    expect(failure).toEqual({
      unavailable: false,
      message: "Older task history could not be loaded. Please try again.",
    });
    expect(failure.message).not.toContain("secret rejected value");
    expect(taskHistoryOlderPageFailure({ code: "CAL01" })).toEqual({
      unavailable: true,
      message: null,
    });
  });

  it("appends without duplicates and preserves order", () => {
    const result = appendActivityPage(activityWindowFromPage(page([row(id1)])), page([row(id1), row(id2)]));
    expect(result.rows.map((item) => item.activityId)).toEqual([id1, id2]);
  });

  it("atomically keeps old rows on failure and clears them only for CAL01", () => {
    const old = activityWindowFromPage(page([row(id1)]));
    expect(replayActivityPages(old, null, "network")).toBe(old);
    expect(replayActivityPages(old, null, "CAL01").rows).toEqual([]);
  });

  it("replays at most five pages and resets deeper windows to page one", () => {
    expect(activityReplayDepth({ ...activityWindowFromPage(page([])), pageCount: 5 })).toBe(5);
    expect(activityReplayDepth({ ...activityWindowFromPage(page([])), pageCount: 6 })).toBe(1);
  });

  it("keeps motion keys stable across filter, refresh, and Load more", () => {
    const initial = [row(id1)];
    const refreshed = [row(id1)];
    const loaded = [row(id1), row(id2)];
    expect(activityMotionKeys(initial)).toEqual(activityMotionKeys(refreshed));
    expect(activityMotionKeys(loaded).slice(0, 1)).toEqual(activityMotionKeys(initial));
  });

  it("has an explicit reduced-motion state", () => {
    expect(activityMotionState(true)).toBe("reduced");
    expect(activityMotionState(false)).toBe("animated");
  });
});

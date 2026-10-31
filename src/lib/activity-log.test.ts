import { describe, expect, it } from "vitest";
import {
  ACTIVITY_LOG_RETENTION_DAYS,
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_ACTION_PRESENTATION,
  ACTIVITY_PREFETCH_PAGES,
  ACTIVITY_SORT_LABELS,
  DEFAULT_ACTIVITY_FILTERS,
  GLOBAL_ACTIVITY_LOG_PAGE_SIZE,
  TASK_HISTORY_PAGE_SIZE,
  addKnownActivityCursor,
  activityActorInitials,
  activityBlockArrowTargets,
  activityCursorStackToPage,
  activityCursorForPage,
  activityEventLabel,
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
  activityLogRetentionNotice,
  canPrefetchActivityPage,
  createActivityPrefetchController,
  createTaskHistoryController,
  shouldStartActivityPrefetch,
  taskHistoryOlderPageFailure,
  taskHistoryPagerVisible,
  taskHistoryKnownCursorsAfterPage,
  taskHistoryToggleCommand,
  globalActivityLogQueryKey,
  isCanonicalUuid,
  normalizeActivityResponse,
  normalizeActivitySearch,
  activityErrorMessage,
  popActivityCursor,
  prefetchActivityPageChain,
  prefetchTaskHistoryPageChain,
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
  it("describes the shared 30-day retention window", () => {
    expect(ACTIVITY_LOG_RETENTION_DAYS).toBe(30);
    expect(activityLogRetentionNotice()).toBe("Activity is kept for 30 days.");
  });

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

  it("keeps Task History task scope and passes its 10-row page size explicitly", () => {
    expect(activityFiltersToRpc(
      DEFAULT_ACTIVITY_FILTERS,
      null,
      id1,
      TASK_HISTORY_PAGE_SIZE,
    )).toMatchObject({
      p_task_id: id1,
      p_sort: "newest",
      p_cursor_created_at: null,
      p_cursor_id: null,
      p_page_size: 10,
    });
    expect(GLOBAL_ACTIVITY_LOG_PAGE_SIZE).toBe(20);
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

  it.each([
    [0, false],
    [10, false],
    [11, true],
    [21, true],
  ])("shows the task History pager only beyond one 10-row page (%i entries)", (entries, expected) => {
    expect(taskHistoryPagerVisible(1, entries > TASK_HISTORY_PAGE_SIZE, entries > TASK_HISTORY_PAGE_SIZE ? 2 : 1)).toBe(expected);
  });

  it("keeps task History collapsed initially and loads only on the first expansion", () => {
    const controller = createTaskHistoryController();
    expect(controller.snapshot()).toMatchObject({
      expanded: false,
      initialRequested: false,
      loaded: false,
    });

    const firstOpen = controller.toggle();
    expect(firstOpen.expanded).toBe(true);
    expect(firstOpen.requestToken).toBe(1);
    expect(controller.settle(1, true, 1_000)).toBe(true);
    expect(controller.toggle()).toEqual({ expanded: false, requestToken: null });
    expect(controller.toggle()).toEqual({ expanded: true, requestToken: null });
  });

  it("keeps one click command live across a Strict Mode effect replay and double state application", () => {
    const controller = createTaskHistoryController();
    controller.unmount();
    controller.mount();

    const command = taskHistoryToggleCommand(controller);
    let renderedExpanded = false;
    for (let invocation = 0; invocation < 2; invocation += 1) {
      renderedExpanded = command.expanded;
    }

    expect(renderedExpanded).toBe(true);
    expect(command.requestToken).toBe(1);
    expect(controller.snapshot()).toMatchObject({
      expanded: true,
      initialRequested: true,
      activeRequestToken: 1,
    });
  });

  it("starts task prefetch only after the first successful expanded load", async () => {
    const page = { rows: [], hasMore: true, cursor: { createdAt: cursor, id: id1 } };
    const collapsed = createTaskHistoryController();
    expect(collapsed.beginPrefetch(1, page)).toBeNull();
    const failed = collapsed.toggle().requestToken!;
    expect(collapsed.beginPrefetch(1, page)).toBeNull();
    expect(collapsed.settle(failed, false, 1_000)).toBe(true);
    expect(collapsed.beginPrefetch(1, page)).toBeNull();

    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    expect(controller.toggle()).toEqual({ expanded: false, requestToken: null });
    expect(controller.beginPrefetch(1, page)).toBeNull();
    expect(controller.toggle()).toEqual({ expanded: true, requestToken: null });
    const result = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => ({ rows: [], hasMore: false, cursor: null }),
    });
    expect(result).toMatchObject({ started: true, accepted: true, failed: false });
  });

  it("prefetches two task pages ahead and exposes a 1 2 3 numbered block", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const c3 = { createdAt: `${cursor}-3`, id: id2 };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let requests = 0;

    const result = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: { rows: [], hasMore: true, cursor: c2 },
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async (pageCursor) => {
        requests += 1;
        return pageCursor === c2
          ? { rows: [], hasMore: true, cursor: c3 }
          : { rows: [], hasMore: false, cursor: null };
      },
    });

    expect(requests).toBe(2);
    expect(result.prefetchCount).toBe(2);
    expect(activityPageBlock(1, result.knownCursors.length)).toEqual([1, 2, 3]);
  });

  it("uses a prefetched task page for navigation without another request", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const page2 = { rows: [], hasMore: false, cursor: null };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let requests = 0;
    await prefetchTaskHistoryPageChain({
      controller,
      initialPage: { rows: [], hasMore: true, cursor: c2 },
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => {
        requests += 1;
        return page2;
      },
    });

    expect(controller.beginNavigationCommand(2, c2)).toEqual({
      type: "cached",
      page: page2,
    });
    expect(requests).toBe(1);
  });

  it.each([
    ["1 to 3 to 1", [3, 1]],
    ["1 to 2 to 1", [2, 1]],
    ["1 to 3 to 2", [3, 2]],
  ])("keeps task History pages 1 2 3 known after %s navigation", async (_label, visits) => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const c3 = { createdAt: `${cursor}-3`, id: id2 };
    const pages = new Map<number, ActivityPage>([
      [1, { rows: [], hasMore: true, cursor: c2 }],
      [2, { rows: [], hasMore: true, cursor: c3 }],
      [3, { rows: [], hasMore: false, cursor: null }],
    ]);
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    const prefetched = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: pages.get(1)!,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async (pageCursor) =>
        pageCursor === c2 ? pages.get(2)! : pages.get(3)!,
    });
    let known = prefetched.knownCursors;

    for (const pageNumber of visits) {
      known = taskHistoryKnownCursorsAfterPage(
        known,
        pageNumber,
        pages.get(pageNumber)!,
      );
    }

    expect(activityPageBlock(1, known.length)).toEqual([1, 2, 3]);
  });

  it("restarts a cancelled task prefetch after collapse and re-expand", () => {
    const page1 = {
      rows: [],
      hasMore: true,
      cursor: { createdAt: `${cursor}-2`, id: id1 },
    };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    const firstChain = controller.beginPrefetch(1, page1);
    expect(firstChain).not.toBeNull();
    expect(controller.toggle().expanded).toBe(false);
    expect(controller.toggle().expanded).toBe(true);

    const restartedChain = controller.beginPrefetch(1, page1);
    expect(restartedChain).not.toBeNull();
    expect(restartedChain).not.toBe(firstChain);
  });

  it("does not add reader requests when navigating 1 to 3 to 1 to 3", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const c3 = { createdAt: `${cursor}-3`, id: id2 };
    const pages = new Map<number, ActivityPage>([
      [1, { rows: [], hasMore: true, cursor: c2 }],
      [2, { rows: [], hasMore: true, cursor: c3 }],
      [3, { rows: [], hasMore: false, cursor: null }],
    ]);
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let requests = 0;
    await prefetchTaskHistoryPageChain({
      controller,
      initialPage: pages.get(1)!,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async (pageCursor) => {
        requests += 1;
        return pageCursor === c2 ? pages.get(2)! : pages.get(3)!;
      },
    });

    expect(controller.beginNavigationCommand(3, c3)?.type).toBe("cached");
    expect(controller.beginNavigationCommand(1, null)?.type).toBe("cached");
    expect(controller.beginNavigationCommand(3, c3)?.type).toBe("cached");
    expect(requests).toBe(2);
  });

  it("continues two pages ahead from a cached navigation without refetching cached pages", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const c3 = { createdAt: `${cursor}-3`, id: id2 };
    const c4 = { createdAt: `${cursor}-4`, id: id3 };
    const page1 = { rows: [], hasMore: true, cursor: c2 };
    const page2 = { rows: [], hasMore: true, cursor: c3 };
    const page3 = { rows: [], hasMore: true, cursor: c4 };
    const page4 = { rows: [], hasMore: false, cursor: null };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let requests = 0;
    const first = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async (pageCursor) => {
        requests += 1;
        return pageCursor === c2 ? page2 : page3;
      },
    });
    expect(requests).toBe(2);
    expect(controller.beginNavigationCommand(2, c2)).toEqual({
      type: "cached",
      page: page2,
    });

    const continued = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page2,
      initialPageNumber: 2,
      knownCursors: first.knownCursors,
      fetchPage: async () => {
        requests += 1;
        return page4;
      },
    });

    expect(continued.accepted).toBe(true);
    expect(requests).toBe(3);
    expect(controller.prefetchedPage(3)).toBe(page3);
    expect(controller.prefetchedPage(4)).toBe(page4);
  });

  it("discards task prefetch results after unmount", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let release!: (page: ActivityPage) => void;
    const pendingPage = new Promise<ActivityPage>((resolve) => { release = resolve; });
    const pending = prefetchTaskHistoryPageChain({
      controller,
      initialPage: { rows: [], hasMore: true, cursor: c2 },
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => pendingPage,
    });
    controller.unmount();
    release({ rows: [], hasMore: false, cursor: null });

    expect(await pending).toMatchObject({ accepted: false });
    expect(controller.snapshot().prefetchedPageNumbers).toEqual([]);
    expect(controller.mount()).toBeNull();
  });

  it("rejects stale task prefetch writes after manual or focus refresh", () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const page1 = { rows: [], hasMore: true, cursor: c2 };

    const manual = createTaskHistoryController();
    const manualInitial = manual.toggle().requestToken!;
    expect(manual.settle(manualInitial, true, 1_000)).toBe(true);
    const manualChain = manual.beginPrefetch(1, page1)!;
    expect(manual.beginManualRefresh(1, null)).not.toBeNull();
    expect(
      manual.cachePrefetchedPage(manualChain, 2, {
        rows: [], hasMore: false, cursor: null,
      }),
    ).toBe(false);

    const focus = createTaskHistoryController();
    const focusInitial = focus.toggle().requestToken!;
    expect(focus.settle(focusInitial, true, 1_000)).toBe(true);
    const focusChain = focus.beginPrefetch(1, page1)!;
    expect(focus.beginFocusRefresh(2_000, 500, 1, null)).not.toBeNull();
    expect(
      focus.cachePrefetchedPage(focusChain, 2, {
        rows: [], hasMore: false, cursor: null,
      }),
    ).toBe(false);
  });

  it("Refresh invalidates task prefetch cache and restarts from the refreshed page", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const page1 = { rows: [], hasMore: true, cursor: c2 };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let requests = 0;
    const fetchPage = async () => {
      requests += 1;
      return { rows: [], hasMore: false, cursor: null };
    };
    await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage,
    });
    expect(controller.snapshot().prefetchedPageNumbers).toEqual([1, 2]);

    const refresh = controller.beginManualRefresh(1, null)!;
    expect(controller.snapshot().prefetchedPageNumbers).toEqual([]);
    expect(controller.settle(refresh, true, 2_000)).toBe(true);
    const restarted = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage,
    });
    expect(restarted.started).toBe(true);
    expect(requests).toBe(2);
  });

  it("keeps a failed task prefetch silent and does not retry it", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const page1 = { rows: [], hasMore: true, cursor: c2 };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let requests = 0;
    const failed = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => {
        requests += 1;
        throw new Error("prefetch failed");
      },
    });
    const retry = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => {
        requests += 1;
        return { rows: [], hasMore: false, cursor: null };
      },
    });
    expect(controller.toggle().expanded).toBe(false);
    expect(controller.toggle().expanded).toBe(true);
    const retryAfterReopen = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => {
        requests += 1;
        return { rows: [], hasMore: false, cursor: null };
      },
    });

    expect(failed).toMatchObject({ started: true, accepted: false, failed: true });
    expect(retry.started).toBe(false);
    expect(retryAfterReopen.started).toBe(false);
    expect(requests).toBe(1);
  });

  it("does not duplicate a completed task prefetch after collapse and re-expand", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const page1 = { rows: [], hasMore: true, cursor: c2 };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let requests = 0;
    const fetchPage = async () => {
      requests += 1;
      return { rows: [], hasMore: false, cursor: null };
    };
    const completed = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage,
    });
    expect(completed.accepted).toBe(true);
    expect(controller.toggle().expanded).toBe(false);
    expect(controller.toggle().expanded).toBe(true);
    const duplicate = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: completed.knownCursors,
      fetchPage,
    });

    expect(duplicate.started).toBe(false);
    expect(requests).toBe(1);
  });

  it("does not prefetch after a failed visible task refresh", () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const page1 = { rows: [], hasMore: true, cursor: c2 };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    const refresh = controller.beginManualRefresh(1, null)!;
    expect(controller.settle(refresh, false, 2_000)).toBe(true);
    expect(controller.toggle().expanded).toBe(false);
    expect(controller.toggle().expanded).toBe(true);
    expect(controller.beginPrefetch(1, page1)).toBeNull();
  });

  it("does not restart or duplicate task prefetch during a Strict Mode replay", async () => {
    const c2 = { createdAt: `${cursor}-2`, id: id1 };
    const page1 = { rows: [], hasMore: true, cursor: c2 };
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    let release!: (page: ActivityPage) => void;
    let requests = 0;
    const pendingPage = new Promise<ActivityPage>((resolve) => { release = resolve; });
    const first = prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => {
        requests += 1;
        return pendingPage;
      },
    });
    const duplicate = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: page1,
      initialPageNumber: 1,
      knownCursors: resetActivityCursorStack(),
      fetchPage: async () => {
        requests += 1;
        return { rows: [], hasMore: false, cursor: null };
      },
    });
    controller.unmount();
    expect(controller.mount()).toBeNull();
    release({ rows: [], hasMore: false, cursor: null });

    expect(duplicate.started).toBe(false);
    expect((await first).accepted).toBe(false);
    expect(requests).toBe(1);
  });

  it("retries a failed first load only after the user collapses and reopens", () => {
    const controller = createTaskHistoryController();
    const first = controller.toggle().requestToken!;
    expect(controller.settle(first, false, 1_000)).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      expanded: true,
      initialRequested: false,
      loaded: false,
      activeRequestToken: null,
    });
    expect(controller.beginFocusRefresh(31_000, 30_000, 1, null)).toBeNull();
    expect(controller.toggle()).toEqual({ expanded: false, requestToken: null });
    expect(controller.toggle()).toEqual({ expanded: true, requestToken: 2 });
  });

  it("does not reopen initial loading for a stale or post-unmount failed settle", () => {
    const staleController = createTaskHistoryController();
    const stale = staleController.toggle().requestToken!;
    const current = staleController.beginNavigation(2, {
      createdAt: cursor,
      id: id1,
    })!;
    expect(staleController.settle(stale, false, 1_000)).toBe(false);
    expect(staleController.snapshot()).toMatchObject({
      initialRequested: true,
      activeRequestToken: current,
    });

    const unmountedController = createTaskHistoryController();
    const unmounted = unmountedController.toggle().requestToken!;
    unmountedController.unmount();
    expect(unmountedController.settle(unmounted, false, 1_000)).toBe(false);
    expect(unmountedController.snapshot().initialRequested).toBe(true);
  });

  it("refreshes on focus only while expanded, loaded, idle, and stale", () => {
    const controller = createTaskHistoryController();
    const first = controller.toggle().requestToken!;
    expect(controller.beginFocusRefresh(31_000, 30_000, 1, null)).toBeNull();
    expect(controller.settle(first, true, 1_000)).toBe(true);
    expect(controller.beginFocusRefresh(30_999, 30_000, 1, null)).toBeNull();
    const focus = controller.beginFocusRefresh(31_000, 30_000, 1, null);
    expect(focus).toBe(2);
    expect(controller.beginFocusRefresh(61_000, 30_000, 1, null)).toBeNull();
    expect(controller.settle(focus!, true, 31_000)).toBe(true);
    controller.toggle();
    expect(controller.beginFocusRefresh(61_000, 30_000, 1, null)).toBeNull();
  });

  it("rejects an older response after a newer page request", () => {
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    const olderPage = controller.beginNavigation(2, { createdAt: cursor, id: id1 })!;
    const newerPage = controller.beginNavigation(3, { createdAt: cursor, id: id2 })!;
    expect(controller.settle(olderPage, true, 2_000)).toBe(false);
    expect(controller.settle(newerPage, true, 2_001)).toBe(true);
  });

  it("rejects an older Refresh response after a newer navigation", () => {
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    const refresh = controller.beginManualRefresh(1, null)!;
    const navigation = controller.beginNavigation(2, { createdAt: cursor, id: id1 })!;
    expect(controller.settle(refresh, true, 2_000)).toBe(false);
    expect(controller.settle(navigation, true, 2_001)).toBe(true);
  });

  it("rejects an in-flight response after unmount", () => {
    const controller = createTaskHistoryController();
    const request = controller.toggle().requestToken!;
    controller.unmount();
    expect(controller.isCurrent(request)).toBe(false);
    expect(controller.settle(request, true, 1_000)).toBe(false);
  });

  it("restarts an interrupted initial load with a new token and rejects the old response", () => {
    const controller = createTaskHistoryController();
    const oldToken = controller.toggle().requestToken!;
    controller.unmount();

    const restart = controller.mount();
    expect(restart).toEqual({
      type: "restart",
      request: {
        requestToken: 2,
        reason: "initial",
        targetPage: 1,
        cursor: null,
      },
    });
    if (!restart || restart.type !== "restart") throw new Error("Expected restart");
    expect(controller.settle(oldToken, true, 1_000)).toBe(false);
    expect(controller.settle(restart.request.requestToken, true, 1_001)).toBe(true);
    expect(controller.snapshot()).toMatchObject({
      loaded: true,
      activeRequestToken: null,
      interruptedRequest: null,
    });
  });

  it("restarts an interrupted page navigation with the same page and cursor", () => {
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    const pageCursor = { createdAt: cursor, id: id1 };
    const oldNavigation = controller.beginNavigation(2, pageCursor)!;
    controller.unmount();

    const restart = controller.mount();
    expect(restart).toEqual({
      type: "restart",
      request: {
        requestToken: 3,
        reason: "navigation",
        targetPage: 2,
        cursor: pageCursor,
      },
    });
    if (!restart || restart.type !== "restart") throw new Error("Expected restart");
    expect(controller.settle(oldNavigation, true, 1_001)).toBe(false);
    expect(controller.settle(restart.request.requestToken, true, 1_002)).toBe(true);
  });

  it("does not restart ordinary mounts, pre-click Strict Mode replay, or completed loads", () => {
    const controller = createTaskHistoryController();
    expect(controller.mount()).toBeNull();
    controller.unmount();
    expect(controller.mount()).toBeNull();

    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    controller.unmount();
    expect(controller.mount()).toBeNull();
    expect(controller.snapshot().activeRequestToken).toBeNull();
  });

  it("mounts without a restart after an ordinary collapsed disconnect", () => {
    const controller = createTaskHistoryController();
    controller.unmount();
    expect(controller.mount()).toBeNull();
    expect(controller.toggle()).toEqual({ expanded: true, requestToken: 1 });
  });

  it("drops an interrupted initial load when reconnecting collapsed and expands once later", () => {
    const controller = createTaskHistoryController();
    const oldToken = controller.toggle().requestToken!;
    controller.unmount();

    expect(controller.mount(false)).toBeNull();
    expect(controller.snapshot()).toMatchObject({
      expanded: false,
      initialRequested: false,
      interruptedRequest: null,
    });
    expect(controller.toggle()).toEqual({ expanded: true, requestToken: 2 });
    expect(controller.settle(oldToken, true, 1_000)).toBe(false);
  });

  it.each([
    ["navigation", (controller: ReturnType<typeof createTaskHistoryController>) =>
      controller.beginNavigation(2, { createdAt: cursor, id: id1 })],
    ["manual Refresh", (controller: ReturnType<typeof createTaskHistoryController>) =>
      controller.beginManualRefresh(1, null)],
    ["focus refresh", (controller: ReturnType<typeof createTaskHistoryController>) =>
      controller.beginFocusRefresh(2_000, 500, 1, null)],
  ])("clears busy after an interrupted %s reconnects collapsed", (_label, begin) => {
    const controller = createTaskHistoryController();
    const initial = controller.toggle().requestToken!;
    expect(controller.settle(initial, true, 1_000)).toBe(true);
    expect(begin(controller)).not.toBeNull();
    controller.unmount();

    expect(controller.mount(false)).toEqual({ type: "clear-busy" });
    expect(controller.snapshot()).toMatchObject({
      expanded: false,
      loaded: true,
      activeRequestToken: null,
      interruptedRequest: null,
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
    expect(activityOpenTaskHref({ taskId: id1, eventName: "Event", isMasked: false, action: "UPDATE" }))
      .toBe(`/tasks/${id1}`);
    expect(activityOpenTaskHref({ taskId: id2, eventName: "Event", isMasked: false, action: "INSERT" }))
      .toBe(`/tasks/${id2}`);
    expect(activityOpenTaskHref({ taskId: "not-a-uuid", eventName: "Event", isMasked: false, action: "UPDATE" }))
      .toBeNull();
    expect(activityOpenTaskHref({ taskId: id1, eventName: "Event", isMasked: true, action: "UPDATE" }))
      .toBeNull();
    expect(activityOpenTaskHref({ taskId: id1, eventName: "Event", isMasked: false, action: "DELETE" }))
      .toBeNull();
    expect(activityOpenTaskHref({ taskId: id1, eventName: null, isMasked: false, action: "UPDATE" }))
      .toBeNull();
  });

  it("labels orphaned history without offering a missing task page", () => {
    expect(activityEventLabel(null)).toBe("Deleted event");
    expect(activityEventLabel("Foundation Week")).toBe("Foundation Week");
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

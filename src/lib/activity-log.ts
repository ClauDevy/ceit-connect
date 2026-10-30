import { isCanonicalUuid } from "@/lib/uuid";

export { isCanonicalUuid };

export const ACTIVITY_LOG_PAGE_SIZE = 20;
export const GLOBAL_ACTIVITY_LOG_PAGE_SIZE = 20;
export const TASK_HISTORY_PAGE_SIZE = 10;
export const ACTIVITY_LOG_RETENTION_DAYS = 30;
export const ACTIVITY_PAGE_BLOCK_SIZE = 3;
export const ACTIVITY_PREFETCH_PAGES = 2;
export const ACTIVITY_LOG_MAX_SEARCH_LENGTH = 100;
export const ACTIVITY_LOG_MAX_REPLAY_PAGES = 5;
export const ACTIVITY_LOG_STALE_TIME = 30_000;

export function activityLogRetentionNotice() {
  return `Activity is kept for ${ACTIVITY_LOG_RETENTION_DAYS} days.`;
}

export const ACTIVITY_SORT_LABELS = {
  newest: "Newest first",
  oldest: "Oldest first",
} as const;

export const ACTIVITY_ACTION_LABELS = {
  INSERT: "Created",
  UPDATE: "Updated",
  DELETE: "Deleted",
} as const;

export const ACTIVITY_ACTION_PRESENTATION = {
  INSERT: { label: "Created", variant: "success", icon: "plus" },
  UPDATE: { label: "Updated", variant: "brand", icon: "pencil" },
  DELETE: { label: "Deleted", variant: "destructive", icon: "trash" },
} as const;

export function activityCommitteeLabels(
  committees: readonly { id: string; name: string }[],
) {
  return Object.fromEntries([
    ["all", "All committees"],
    ...committees.map((committee) => [committee.id, committee.name]),
  ]);
}

export type ActivitySort = keyof typeof ACTIVITY_SORT_LABELS;
export type ActivityAction = keyof typeof ACTIVITY_ACTION_LABELS;

export type ActivityFilters = {
  sort: ActivitySort;
  action: ActivityAction | null;
  committeeId: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  search: string | null;
};

export type ActivityCursor = {
  createdAt: string;
  id: string;
};

export type ActivityCursorStack = readonly (ActivityCursor | null)[];

export type TaskHistoryRequestReason =
  | "initial"
  | "navigation"
  | "refresh"
  | "focus";

export type TaskHistoryRequestCommand = {
  requestToken: number;
  reason: TaskHistoryRequestReason;
  targetPage: number;
  cursor: ActivityCursor | null;
};

export type TaskHistoryMountCommand =
  | { type: "restart"; request: TaskHistoryRequestCommand }
  | { type: "clear-busy" };

export type TaskHistoryNavigationCommand =
  | { type: "request"; requestToken: number }
  | { type: "cached"; page: ActivityPage };

export type ActivityRow = {
  activityId: string;
  activityCreatedAt: string;
  action: ActivityAction;
  taskId: string | null;
  taskTitle: string;
  eventName: string | null;
  committeeId: string | null;
  committeeName: string | null;
  actorName: string | null;
  changeSummary: string[] | null;
  isMasked: boolean;
};

export type ActivityPage = {
  rows: ActivityRow[];
  hasMore: boolean;
  cursor: ActivityCursor | null;
};

export type ActivityWindow = ActivityPage & {
  pageCount: number;
  unavailable: boolean;
};

export type ActivityRpcRow = {
  activity_id: unknown;
  activity_created_at: unknown;
  action: unknown;
  task_id: unknown;
  task_title: unknown;
  event_name: unknown;
  committee_id: unknown;
  committee_name: unknown;
  actor_name: unknown;
  change_summary: unknown;
  is_masked: unknown;
  has_more: unknown;
  next_cursor_created_at: unknown;
  next_cursor_id: unknown;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

export const DEFAULT_ACTIVITY_FILTERS: ActivityFilters = {
  sort: "newest",
  action: null,
  committeeId: null,
  dateFrom: null,
  dateTo: null,
  search: null,
};

function isActivityAction(value: unknown): value is ActivityAction {
  return value === "INSERT" || value === "UPDATE" || value === "DELETE";
}

export function normalizeActivitySearch(value: string | null | undefined) {
  const search = value?.trim() ?? "";
  if (
    search.length > ACTIVITY_LOG_MAX_SEARCH_LENGTH ||
    CONTROL_PATTERN.test(search)
  ) {
    return { value: null, error: "The activity log request is invalid." };
  }
  return { value: search || null, error: null };
}

export function validateActivityFilters(filters: ActivityFilters): string | null {
  if (
    (filters.dateFrom !== null && !DATE_PATTERN.test(filters.dateFrom)) ||
    (filters.dateTo !== null && !DATE_PATTERN.test(filters.dateTo)) ||
    (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo)
  ) {
    return "The activity log request is invalid.";
  }
  return normalizeActivitySearch(filters.search).error;
}

export function normalizeActivityFilters(filters: ActivityFilters): ActivityFilters {
  return {
    ...filters,
    search: normalizeActivitySearch(filters.search).value,
  };
}

export function isDefaultActivityFilters(filters: ActivityFilters) {
  return JSON.stringify(normalizeActivityFilters(filters)) ===
    JSON.stringify(DEFAULT_ACTIVITY_FILTERS);
}

export function activityLogQueryKey(
  scope: { taskId: string | null },
  filters: ActivityFilters,
) {
  const normalized = normalizeActivityFilters(filters);
  return [
    "activity-log",
    scope.taskId ?? "global",
    normalized.sort,
    normalized.action,
    normalized.committeeId,
    normalized.dateFrom,
    normalized.dateTo,
    normalized.search,
  ] as const;
}

export function globalActivityLogQueryKey(
  filters: ActivityFilters,
  cursor: ActivityCursor | null,
) {
  return [
    ...activityLogQueryKey({ taskId: null }, filters),
    cursor?.createdAt ?? null,
    cursor?.id ?? null,
  ] as const;
}

export function taskHistoryQueryKey(taskId: string) {
  return activityLogQueryKey({ taskId }, DEFAULT_ACTIVITY_FILTERS);
}

export function activityFiltersToRpc(
  filters: ActivityFilters,
  cursor: ActivityCursor | null,
  taskId: string | null,
  pageSize = ACTIVITY_LOG_PAGE_SIZE,
) {
  const normalized = normalizeActivityFilters(filters);
  return {
    p_task_id: taskId,
    p_sort: normalized.sort,
    p_action: normalized.action,
    p_committee_id: normalized.committeeId,
    p_date_from: normalized.dateFrom,
    p_date_to: normalized.dateTo,
    p_search: normalized.search,
    p_cursor_created_at: cursor?.createdAt ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_page_size: pageSize,
  };
}

export function resetActivityCursorStack(): ActivityCursorStack {
  return [null];
}

export function pushActivityCursor(
  stack: ActivityCursorStack,
  cursor: ActivityCursor,
): ActivityCursorStack {
  return [...stack, cursor];
}

export function popActivityCursor(
  stack: ActivityCursorStack,
): ActivityCursorStack {
  return stack.length > 1 ? stack.slice(0, -1) : stack;
}

export function activityCursorStackToPage(
  stack: ActivityCursorStack,
  page: number,
): ActivityCursorStack {
  return page >= 1 && page <= stack.length ? stack.slice(0, page) : stack;
}

export function visibleActivityPageNumbers(
  activePage: number,
  maximum = 3,
) {
  const first = Math.max(1, activePage - Math.max(1, maximum) + 1);
  return Array.from(
    { length: activePage - first + 1 },
    (_, index) => first + index,
  );
}

export function activityPagerState(activePage: number, hasMore: boolean) {
  return {
    show: activePage > 1 || hasMore,
    canPrevious: activePage > 1,
    canNext: hasMore,
  };
}

export function taskHistoryPagerVisible(
  activePage: number,
  hasMore: boolean,
  knownPageCount: number,
) {
  return activePage > 1 || hasMore || knownPageCount > 1;
}

export function taskHistoryKnownCursorsAfterPage(
  cursors: ActivityCursorStack,
  pageNumber: number,
  page: Pick<ActivityPage, "hasMore" | "cursor">,
  resetPagesAhead = false,
) {
  let next = resetPagesAhead
    ? activityCursorStackToPage(cursors, pageNumber)
    : cursors;
  if (
    page.hasMore &&
    page.cursor &&
    activityCursorForPage(next, pageNumber + 1) === undefined
  ) {
    next = addKnownActivityCursor(next, pageNumber + 1, page.cursor);
  }
  return next;
}

export function addKnownActivityCursor(
  cursors: ActivityCursorStack,
  page: number,
  cursor: ActivityCursor,
): ActivityCursorStack {
  if (page < 2 || page > cursors.length + 1) return cursors;
  const existing = cursors[page - 1];
  if (
    existing?.createdAt === cursor.createdAt &&
    existing.id === cursor.id
  ) {
    return cursors;
  }
  if (page === cursors.length + 1) return [...cursors, cursor];
  return [...cursors.slice(0, page - 1), cursor];
}

export function activityCursorForPage(
  cursors: ActivityCursorStack,
  page: number,
) {
  return page >= 1 && page <= cursors.length
    ? cursors[page - 1]
    : undefined;
}

export function activityPageBlock(
  activePage: number,
  knownPageCount: number,
) {
  const start =
    Math.floor((Math.max(activePage, 1) - 1) / ACTIVITY_PAGE_BLOCK_SIZE) *
      ACTIVITY_PAGE_BLOCK_SIZE +
    1;
  const end = Math.min(start + ACTIVITY_PAGE_BLOCK_SIZE - 1, knownPageCount);
  return end < start
    ? []
    : Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function activityPagerSlots(pageNumbers: readonly number[]) {
  return Array.from({ length: ACTIVITY_PAGE_BLOCK_SIZE }, (_, slot) => {
    const page = pageNumbers[slot] ?? null;
    return {
      key: page === null ? `slot-${slot}` : `page-${page}`,
      page,
    };
  });
}

export function activityBlockArrowTargets(activePage: number) {
  const start =
    Math.floor((Math.max(activePage, 1) - 1) / ACTIVITY_PAGE_BLOCK_SIZE) *
      ACTIVITY_PAGE_BLOCK_SIZE +
    1;
  return {
    previous: start > 1 ? start - ACTIVITY_PAGE_BLOCK_SIZE : null,
    next: start + ACTIVITY_PAGE_BLOCK_SIZE,
  };
}

export function canPrefetchActivityPage(
  hasMore: boolean,
  pagesAhead: number,
  tabVisible: boolean,
) {
  return hasMore && tabVisible && pagesAhead < ACTIVITY_PREFETCH_PAGES;
}

export function shouldStartActivityPrefetch({
  activePage,
  filters,
  hasMore,
  cursor,
  tabVisible,
  source,
}: {
  activePage: number;
  filters: ActivityFilters;
  hasMore: boolean;
  cursor: ActivityCursor | null;
  tabVisible: boolean;
  source: "initial" | "query";
}) {
  const sourceIsCurrent =
    source === "query" ||
    (activePage === 1 && isDefaultActivityFilters(filters));
  return sourceIsCurrent && hasMore && cursor !== null && tabVisible;
}

type ActivityPrefetchPage = Pick<
  ActivityWindow,
  "hasMore" | "cursor" | "unavailable"
>;

export function createActivityPrefetchController() {
  let nextChainId = 0;
  let activeChainId: number | null = null;
  return {
    start() {
      nextChainId += 1;
      activeChainId = nextChainId;
      return activeChainId;
    },
    cancel() {
      activeChainId = null;
    },
    currentChainId() {
      return activeChainId;
    },
  };
}

export function createTaskHistoryController() {
  const prefetchController = createActivityPrefetchController();
  const prefetchedPages = new Map<number, ActivityPage>();
  let mounted = true;
  let expanded = false;
  let initialRequested = false;
  let loaded = false;
  let nextRequestToken = 0;
  let activeRequestToken: number | null = null;
  let activeRequest: TaskHistoryRequestCommand | null = null;
  let interruptedRequest: Omit<TaskHistoryRequestCommand, "requestToken"> | null =
    null;
  let lastLoadedAt: number | null = null;
  let lastVisibleLoadSucceeded = false;
  let prefetchAttemptKey: string | null = null;

  function cancelPrefetch() {
    if (prefetchController.currentChainId() !== null) {
      prefetchAttemptKey = null;
    }
    prefetchController.cancel();
  }

  function invalidatePrefetch() {
    cancelPrefetch();
    prefetchAttemptKey = null;
    prefetchedPages.clear();
  }

  function beginRequest(
    request: Omit<TaskHistoryRequestCommand, "requestToken">,
  ) {
    if (!mounted) return null;
    nextRequestToken += 1;
    activeRequestToken = nextRequestToken;
    activeRequest = { ...request, requestToken: activeRequestToken };
    return activeRequest;
  }

  return {
    mount(currentExpanded = expanded) {
      mounted = true;
      expanded = currentExpanded;
      const request = interruptedRequest;
      interruptedRequest = null;
      if (!request) return null;
      if (!expanded) {
        if (!loaded) initialRequested = false;
        return request.reason === "initial"
          ? null
          : ({ type: "clear-busy" } satisfies TaskHistoryMountCommand);
      }
      const restart = beginRequest(request);
      return restart
        ? ({ type: "restart", request: restart } satisfies TaskHistoryMountCommand)
        : null;
    },
    toggle() {
      if (!mounted) {
        return { expanded: false, requestToken: null };
      }
      expanded = !expanded;
      if (!expanded) cancelPrefetch();
      let requestToken: number | null = null;
      if (expanded && !initialRequested) {
        initialRequested = true;
        requestToken = beginRequest({
          reason: "initial",
          targetPage: 1,
          cursor: null,
        })?.requestToken ?? null;
      }
      return { expanded, requestToken };
    },
    beginNavigation(targetPage: number, cursor: ActivityCursor | null) {
      cancelPrefetch();
      return mounted && expanded
        ? beginRequest({ reason: "navigation", targetPage, cursor })
            ?.requestToken ?? null
        : null;
    },
    beginNavigationCommand(
      targetPage: number,
      cursor: ActivityCursor | null,
    ): TaskHistoryNavigationCommand | null {
      if (!mounted || !expanded) return null;
      cancelPrefetch();
      const cached = prefetchedPages.get(targetPage);
      if (cached) {
        lastVisibleLoadSucceeded = true;
        return { type: "cached", page: cached };
      }
      const requestToken = beginRequest({
        reason: "navigation",
        targetPage,
        cursor,
      })?.requestToken;
      return requestToken === undefined
        ? null
        : { type: "request", requestToken };
    },
    beginManualRefresh(targetPage: number, cursor: ActivityCursor | null) {
      if (!mounted || !expanded || activeRequestToken !== null) return null;
      invalidatePrefetch();
      return beginRequest({ reason: "refresh", targetPage, cursor })
        ?.requestToken ?? null;
    },
    beginFocusRefresh(
      now: number,
      staleTime: number,
      targetPage: number,
      cursor: ActivityCursor | null,
    ) {
      if (
        !mounted ||
        !expanded ||
        !loaded ||
        activeRequestToken !== null ||
        lastLoadedAt === null ||
        now - lastLoadedAt < staleTime
      ) {
        return null;
      }
      invalidatePrefetch();
      return beginRequest({ reason: "focus", targetPage, cursor })
        ?.requestToken ?? null;
    },
    settle(requestToken: number, didLoad: boolean, settledAt: number) {
      if (!mounted || activeRequestToken !== requestToken) return false;
      activeRequestToken = null;
      activeRequest = null;
      if (didLoad) {
        loaded = true;
        lastLoadedAt = settledAt;
      } else if (!loaded) {
        initialRequested = false;
      }
      lastVisibleLoadSucceeded = didLoad;
      return true;
    },
    isCurrent(requestToken: number) {
      return mounted && activeRequestToken === requestToken;
    },
    beginPrefetch(
      activePage: number,
      currentPage: Pick<ActivityPage, "hasMore" | "cursor">,
    ) {
      if (
        !mounted ||
        !expanded ||
        !loaded ||
        !lastVisibleLoadSucceeded ||
        activeRequestToken !== null ||
        !currentPage.hasMore ||
        !currentPage.cursor
      ) {
        return null;
      }
      const attemptKey = [
        activePage,
        currentPage.cursor.createdAt,
        currentPage.cursor.id,
      ].join(":");
      if (prefetchAttemptKey === attemptKey) return null;
      prefetchAttemptKey = attemptKey;
      return prefetchController.start();
    },
    isPrefetchCurrent(chainId: number) {
      return (
        mounted &&
        expanded &&
        prefetchController.currentChainId() === chainId
      );
    },
    cachePrefetchedPage(chainId: number, pageNumber: number, page: ActivityPage) {
      if (
        !mounted ||
        !expanded ||
        prefetchController.currentChainId() !== chainId
      ) {
        return false;
      }
      prefetchedPages.set(pageNumber, page);
      return true;
    },
    prefetchedPage(pageNumber: number) {
      return prefetchedPages.get(pageNumber) ?? null;
    },
    rememberVisiblePage(pageNumber: number, page: ActivityPage) {
      if (!mounted || !loaded || !lastVisibleLoadSucceeded) return false;
      prefetchedPages.set(pageNumber, page);
      return true;
    },
    finishPrefetch(chainId: number) {
      if (prefetchController.currentChainId() !== chainId) return false;
      prefetchController.cancel();
      return mounted && expanded;
    },
    unmount() {
      if (activeRequest) {
        interruptedRequest = {
          reason: activeRequest.reason,
          targetPage: activeRequest.targetPage,
          cursor: activeRequest.cursor,
        };
      }
      mounted = false;
      activeRequestToken = null;
      activeRequest = null;
      cancelPrefetch();
      prefetchedPages.clear();
    },
    snapshot() {
      return {
        mounted,
        expanded,
        initialRequested,
        loaded,
        activeRequestToken,
        interruptedRequest,
        lastLoadedAt,
        lastVisibleLoadSucceeded,
        prefetchChainId: prefetchController.currentChainId(),
        prefetchAttemptKey,
        prefetchedPageNumbers: [...prefetchedPages.keys()],
      };
    },
  };
}

export function taskHistoryToggleCommand(
  controller: ReturnType<typeof createTaskHistoryController>,
) {
  return controller.toggle();
}

export async function prefetchActivityPageChain({
  initialPage,
  initialPageNumber,
  knownCursors,
  fetchPage,
  isCancelled,
}: {
  initialPage: ActivityPrefetchPage;
  initialPageNumber: number;
  knownCursors: ActivityCursorStack;
  fetchPage: (cursor: ActivityCursor) => Promise<ActivityPrefetchPage>;
  isCancelled: () => boolean;
}) {
  let cursors = knownCursors;
  let cursor = initialPage.cursor;
  let hasMore = initialPage.hasMore;
  let prefetchCount = 0;

  if (hasMore && cursor) {
    cursors = addKnownActivityCursor(
      cursors,
      initialPageNumber + 1,
      cursor,
    );
  }

  for (let ahead = 0; ahead < ACTIVITY_PREFETCH_PAGES; ahead += 1) {
    if (isCancelled()) {
      return {
        cancelled: true,
        knownCursors: resetActivityCursorStack(),
        prefetchCount,
      };
    }
    if (!hasMore || !cursor) break;

    const prefetched = await fetchPage(cursor);
    prefetchCount += 1;
    if (isCancelled()) {
      return {
        cancelled: true,
        knownCursors: resetActivityCursorStack(),
        prefetchCount,
      };
    }
    if (prefetched.unavailable) break;

    const prefetchedPageNumber = initialPageNumber + ahead + 1;
    if (prefetched.hasMore && prefetched.cursor) {
      cursors = addKnownActivityCursor(
        cursors,
        prefetchedPageNumber + 1,
        prefetched.cursor,
      );
    }
    hasMore = prefetched.hasMore;
    cursor = prefetched.cursor;
  }

  return { cancelled: false, knownCursors: cursors, prefetchCount };
}

export async function prefetchTaskHistoryPageChain({
  controller,
  initialPage,
  initialPageNumber,
  knownCursors,
  fetchPage,
}: {
  controller: ReturnType<typeof createTaskHistoryController>;
  initialPage: ActivityPage;
  initialPageNumber: number;
  knownCursors: ActivityCursorStack;
  fetchPage: (cursor: ActivityCursor) => Promise<ActivityPage>;
}) {
  controller.rememberVisiblePage(initialPageNumber, initialPage);
  const chainId = controller.beginPrefetch(initialPageNumber, initialPage);
  if (chainId === null) {
    return {
      started: false,
      accepted: false,
      failed: false,
      knownCursors,
      prefetchCount: 0,
    };
  }

  let targetPage = initialPageNumber + 1;
  try {
    const result = await prefetchActivityPageChain({
      initialPage: { ...initialPage, unavailable: false },
      initialPageNumber,
      knownCursors,
      isCancelled: () => !controller.isPrefetchCurrent(chainId),
      fetchPage: async (cursor) => {
        const pageNumber = targetPage;
        targetPage += 1;
        const cached = controller.prefetchedPage(pageNumber);
        const page = cached ?? await fetchPage(cursor);
        controller.cachePrefetchedPage(chainId, pageNumber, page);
        return { ...page, unavailable: false };
      },
    });
    const accepted =
      !result.cancelled && controller.finishPrefetch(chainId);
    return {
      started: true,
      accepted,
      failed: false,
      knownCursors: accepted ? result.knownCursors : knownCursors,
      prefetchCount: result.prefetchCount,
    };
  } catch {
    controller.finishPrefetch(chainId);
    return {
      started: true,
      accepted: false,
      failed: true,
      knownCursors,
      prefetchCount: targetPage - initialPageNumber - 1,
    };
  }
}

export function activityActorInitials(name: string | null) {
  const words = name?.trim().split(/\s+/u).filter(Boolean) ?? [];
  if (words.length === 0) return null;
  if (words.length === 1) {
    return Array.from(words[0]).slice(0, 2).join("").toLocaleUpperCase();
  }
  const first = Array.from(words[0])[0] ?? "";
  const last = Array.from(words.at(-1) ?? "")[0] ?? "";
  return `${first}${last}`.toLocaleUpperCase();
}

export function activityOpenTaskHref(
  row: Pick<ActivityRow, "taskId" | "isMasked" | "action">,
) {
  return !row.isMasked && row.action !== "DELETE" && isCanonicalUuid(row.taskId)
    ? `/tasks/${row.taskId}`
    : null;
}

function nullableString(value: unknown) {
  return value === null || typeof value === "string" ? value : undefined;
}

function nullableUuid(value: unknown) {
  return value === null || isCanonicalUuid(value) ? value : undefined;
}

export function normalizeActivityResponse(value: unknown): ActivityPage {
  if (!Array.isArray(value)) throw new Error("The activity log returned an invalid response.");
  const rows: ActivityRow[] = [];
  let hasMore = false;
  let cursor: ActivityCursor | null = null;

  for (const candidate of value as ActivityRpcRow[]) {
    if (!candidate || typeof candidate !== "object")
      throw new Error("The activity log returned an invalid response.");
    if (typeof candidate.has_more !== "boolean")
      throw new Error("The activity log returned an invalid response.");
    hasMore ||= candidate.has_more;
    if (candidate.has_more) {
      if (
        typeof candidate.next_cursor_created_at !== "string" ||
        !isCanonicalUuid(candidate.next_cursor_id)
      ) throw new Error("The activity log returned an invalid response.");
      cursor = {
        createdAt: candidate.next_cursor_created_at,
        id: candidate.next_cursor_id,
      };
    }
    if (candidate.activity_id === null) continue;
    const taskId = nullableUuid(candidate.task_id);
    const committeeId = nullableUuid(candidate.committee_id);
    const eventName = nullableString(candidate.event_name);
    const committeeName = nullableString(candidate.committee_name);
    const actorName = nullableString(candidate.actor_name);
    if (
      !isCanonicalUuid(candidate.activity_id) ||
      typeof candidate.activity_created_at !== "string" ||
      !isActivityAction(candidate.action) ||
      typeof candidate.task_title !== "string" ||
      taskId === undefined || committeeId === undefined ||
      eventName === undefined || committeeName === undefined || actorName === undefined ||
      typeof candidate.is_masked !== "boolean" ||
      !(candidate.change_summary === null ||
        (Array.isArray(candidate.change_summary) && candidate.change_summary.every((item) => typeof item === "string")))
    ) throw new Error("The activity log returned an invalid response.");
    rows.push({
      activityId: candidate.activity_id,
      activityCreatedAt: candidate.activity_created_at,
      action: candidate.action,
      taskId, taskTitle: candidate.task_title, eventName, committeeId,
      committeeName, actorName,
      changeSummary: candidate.change_summary as string[] | null,
      isMasked: candidate.is_masked,
    });
  }
  return { rows, hasMore, cursor: hasMore ? cursor : null };
}

export function appendActivityPage(window: ActivityWindow, page: ActivityPage): ActivityWindow {
  const seen = new Set<string>();
  const rows = [...window.rows, ...page.rows].filter((row) => {
    if (seen.has(row.activityId)) return false;
    seen.add(row.activityId);
    return true;
  });
  return { ...page, rows, pageCount: window.pageCount + 1, unavailable: false };
}

export function activityWindowFromPage(page: ActivityPage): ActivityWindow {
  return { ...page, pageCount: 1, unavailable: false };
}

export function unavailableActivityWindow(): ActivityWindow {
  return { rows: [], hasMore: false, cursor: null, pageCount: 0, unavailable: true };
}

export function replayActivityPages(
  previous: ActivityWindow,
  pages: readonly ActivityPage[] | null,
  errorCode: string | null,
) {
  if (errorCode === "CAL01") return unavailableActivityWindow();
  if (!pages) return previous;
  let next = activityWindowFromPage(pages[0] ?? { rows: [], hasMore: false, cursor: null });
  for (const page of pages.slice(1, ACTIVITY_LOG_MAX_REPLAY_PAGES)) next = appendActivityPage(next, page);
  return next;
}

export function activityReplayDepth(window: ActivityWindow) {
  return window.pageCount > ACTIVITY_LOG_MAX_REPLAY_PAGES ? 1 : Math.max(window.pageCount, 1);
}

export function activityErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export function activityErrorMessage(error: unknown) {
  return activityErrorCode(error) === "CAL01"
    ? "Activity history is unavailable."
    : "Activity history could not be loaded.";
}

export function taskHistoryOlderPageFailure(error: unknown) {
  return activityErrorCode(error) === "CAL01"
    ? { unavailable: true, message: null }
    : {
        unavailable: false,
        message: "Older task history could not be loaded. Please try again.",
      };
}

export function activityMotionKeys(rows: readonly ActivityRow[]) {
  return rows.map((row) => row.activityId);
}

export function activityMotionState(reduced: boolean) {
  return reduced ? "reduced" : "animated";
}

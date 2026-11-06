"use client";

import { EmptyState } from "@/components/shared/empty-state";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Search, SlidersHorizontal } from "lucide-react";
import { ActivityLogList } from "@/components/activity-log/activity-log-list";
import { ListPager } from "@/components/shared/list-pager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ACTIVITY_ACTION_LABELS,
  ACTIVITY_LOG_STALE_TIME,
  ACTIVITY_SORT_LABELS,
  DEFAULT_ACTIVITY_FILTERS,
  GLOBAL_ACTIVITY_LOG_PAGE_SIZE,
  activityBlockArrowTargets,
  activityCommitteeLabels,
  activityCursorForPage,
  activityErrorCode,
  activityErrorMessage,
  activityFiltersToRpc,
  activityPageBlock,
  activityPagerSlots,
  activityWindowFromPage,
  addKnownActivityCursor,
  createActivityPrefetchController,
  globalActivityLogQueryKey,
  isDefaultActivityFilters,
  normalizeActivityResponse,
  prefetchActivityPageChain,
  resetActivityCursorStack,
  shouldStartActivityPrefetch,
  unavailableActivityWindow,
  validateActivityFilters,
  type ActivityCursor,
  type ActivityCursorStack,
  type ActivityFilters,
  type ActivityWindow,
} from "@/lib/activity-log";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Committee = { id: string; name: string };
type Props = {
  initialWindow: ActivityWindow;
  initialLoadFailed: boolean;
  committees: Committee[];
};

const GLOBAL_QUERY_PREFIX = ["activity-log", "global"] as const;

export function ActivityLogPageClient({
  initialWindow,
  initialLoadFailed,
  committees,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_ACTIVITY_FILTERS);
  const [searchInput, setSearchInput] = useState("");
  const [knownCursors, setKnownCursors] = useState<ActivityCursorStack>(() =>
    resetActivityCursorStack(),
  );
  const knownCursorsRef = useRef<ActivityCursorStack>(resetActivityCursorStack());
  const [activePage, setActivePage] = useState(1);
  const [accessUnavailable, setAccessUnavailable] = useState(
    initialWindow.unavailable,
  );
  const [navigationError, setNavigationError] = useState<string | null>(
    initialLoadFailed ? "Activity history could not be loaded." : null,
  );
  const [navigating, setNavigating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [prefetching, setPrefetching] = useState(false);
  const busy = useRef(false);
  const requestGeneration = useRef(0);
  const prefetchController = useRef(createActivityPrefetchController());
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committeeLabels = useMemo(
    () => activityCommitteeLabels(committees),
    [committees],
  );
  const currentCursor = activityCursorForPage(knownCursors, activePage);
  const validationError = validateActivityFilters(filters);
  const queryKey = globalActivityLogQueryKey(filters, currentCursor ?? null);

  useEffect(() => {
    const controller = prefetchController.current;
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
      controller.cancel();
      void queryClient.cancelQueries({ queryKey: GLOBAL_QUERY_PREFIX });
    };
  }, [queryClient]);

  const readWindow = useCallback(
    async (
      requestedFilters: ActivityFilters,
      cursor: ActivityCursor | null,
      signal?: AbortSignal,
    ) => {
      let request = supabase.rpc(
        "list_activity_log",
        activityFiltersToRpc(
          requestedFilters,
          cursor,
          null,
          GLOBAL_ACTIVITY_LOG_PAGE_SIZE,
        ),
      );
      if (signal) request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      return activityWindowFromPage(normalizeActivityResponse(data));
    },
    [supabase],
  );

  const clearForUnavailable = useCallback(() => {
    requestGeneration.current += 1;
    prefetchController.current.cancel();
    void queryClient.cancelQueries({ queryKey: GLOBAL_QUERY_PREFIX });
    queryClient.removeQueries({ queryKey: GLOBAL_QUERY_PREFIX });
    const resetCursors = resetActivityCursorStack();
    knownCursorsRef.current = resetCursors;
    setKnownCursors(resetCursors);
    setActivePage(1);
    setPrefetching(false);
    setAccessUnavailable(true);
    setNavigationError(null);
  }, [queryClient]);

  async function fetchCurrentWindow(signal?: AbortSignal) {
    try {
      const result = await readWindow(filters, currentCursor ?? null, signal);
      setAccessUnavailable(false);
      setNavigationError(null);
      return result;
    } catch (error) {
      if (activityErrorCode(error) === "CAL01") {
        clearForUnavailable();
        return unavailableActivityWindow();
      }
      throw error;
    }
  }

  const query = useQuery({
    queryKey,
    enabled:
      validationError === null &&
      !accessUnavailable &&
      currentCursor !== undefined,
    initialData:
      !initialLoadFailed &&
      activePage === 1 &&
      isDefaultActivityFilters(filters)
        ? initialWindow
        : undefined,
    staleTime: ACTIVITY_LOG_STALE_TIME,
    refetchOnWindowFocus: true,
    retry: false,
    queryFn: ({ signal }) => fetchCurrentWindow(signal),
  });

  useEffect(() => {
    const controller = prefetchController.current;
    const initialDefaultWindow =
      !initialLoadFailed &&
      activePage === 1 &&
      isDefaultActivityFilters(filters)
        ? initialWindow
        : undefined;
    const firstPage = query.data ?? initialDefaultWindow;
    const prefetchSource = query.data ? "query" : "initial";
    if (
      !firstPage ||
      firstPage.unavailable ||
      validationError ||
      accessUnavailable
    ) {
      return;
    }

    if (firstPage.hasMore && firstPage.cursor) {
      const nextCursor = firstPage.cursor;
      const cursorGeneration = requestGeneration.current;
      const nextCursors = addKnownActivityCursor(
        knownCursorsRef.current,
        activePage + 1,
        nextCursor,
      );
      knownCursorsRef.current = nextCursors;
      queueMicrotask(() => {
        if (cursorGeneration !== requestGeneration.current) return;
        setKnownCursors(nextCursors);
      });
    }

    if (
      !firstPage.cursor ||
      !shouldStartActivityPrefetch({
        activePage,
        filters,
        hasMore: firstPage.hasMore,
        cursor: firstPage.cursor,
        tabVisible: document.visibilityState === "visible",
        source: prefetchSource,
      })
    ) {
      return;
    }

    const generation = requestGeneration.current;
    const requestedFilters = filters;
    const chainId = controller.start();
    queueMicrotask(() => {
      if (controller.currentChainId() === chainId) setPrefetching(true);
    });

    void (async () => {
      try {
        const result = await prefetchActivityPageChain({
          initialPage: firstPage,
          initialPageNumber: activePage,
          knownCursors: knownCursorsRef.current,
          isCancelled: () =>
            generation !== requestGeneration.current ||
            controller.currentChainId() !== chainId,
          fetchPage: async (pageCursor) => {
            const pageKey = globalActivityLogQueryKey(
              requestedFilters,
              pageCursor,
            );
            await queryClient.prefetchQuery({
              queryKey: pageKey,
              queryFn: async ({ signal }) => {
                try {
                  return await readWindow(requestedFilters, pageCursor, signal);
                } catch (error) {
                  if (activityErrorCode(error) === "CAL01") {
                    clearForUnavailable();
                    return unavailableActivityWindow();
                  }
                  throw error;
                }
              },
              staleTime: ACTIVITY_LOG_STALE_TIME,
              retry: false,
            });
            const prefetched = queryClient.getQueryData<ActivityWindow>(pageKey);
            return prefetched ?? unavailableActivityWindow();
          },
        });
        if (
          !result.cancelled &&
          generation === requestGeneration.current &&
          controller.currentChainId() === chainId
        ) {
          knownCursorsRef.current = result.knownCursors;
          setKnownCursors(result.knownCursors);
        }
      } catch (error) {
        if (activityErrorCode(error) === "CAL01") clearForUnavailable();
      } finally {
        if (controller.currentChainId() === chainId) {
          controller.cancel();
          setPrefetching(false);
        }
      }
    })();

    return () => {
      if (controller.currentChainId() === chainId) {
        controller.cancel();
        setPrefetching(false);
      }
      void queryClient.cancelQueries({ queryKey: GLOBAL_QUERY_PREFIX });
    };
  }, [
    accessUnavailable,
    activePage,
    clearForUnavailable,
    currentCursor,
    filters,
    initialLoadFailed,
    initialWindow,
    query.data,
    queryClient,
    readWindow,
    validationError,
  ]);

  function resetPaging() {
    requestGeneration.current += 1;
    prefetchController.current.cancel();
    void queryClient.cancelQueries({ queryKey: GLOBAL_QUERY_PREFIX });
    const resetCursors = resetActivityCursorStack();
    knownCursorsRef.current = resetCursors;
    setKnownCursors(resetCursors);
    setActivePage(1);
    setPrefetching(false);
    setNavigationError(null);
  }

  function changeFilter(patch: Partial<ActivityFilters>) {
    resetPaging();
    setFilters((current) => ({ ...current, ...patch }));
  }

  function changeSearch(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      resetPaging();
      setFilters((current) => ({ ...current, search: value }));
    }, 300);
  }

  function clearFilters() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchInput("");
    resetPaging();
    setFilters(DEFAULT_ACTIVITY_FILTERS);
  }

  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    setNavigationError(null);
    try {
      const result = await query.refetch();
      if (result.error && activityErrorCode(result.error) !== "CAL01") {
        setNavigationError(activityErrorMessage(result.error));
      }
    } finally {
      busy.current = false;
      setRefreshing(false);
    }
  }

  async function navigate(page: number) {
    if (busy.current || page === activePage) return;
    const cursor = activityCursorForPage(knownCursors, page);
    if (cursor === undefined) return;
    const generation = requestGeneration.current;
    busy.current = true;
    setNavigating(true);
    setNavigationError(null);
    try {
      const result = await queryClient.fetchQuery({
        queryKey: globalActivityLogQueryKey(filters, cursor),
        queryFn: async ({ signal }) => {
          try {
            return await readWindow(filters, cursor, signal);
          } catch (error) {
            if (activityErrorCode(error) === "CAL01") {
              clearForUnavailable();
              return unavailableActivityWindow();
            }
            throw error;
          }
        },
        staleTime: ACTIVITY_LOG_STALE_TIME,
      });
      if (!result.unavailable && generation === requestGeneration.current) {
        setActivePage(page);
      }
    } catch (error) {
      if (activityErrorCode(error) !== "CAL01") {
        setNavigationError(activityErrorMessage(error));
      }
    } finally {
      busy.current = false;
      setNavigating(false);
    }
  }

  const window = query.data;
  const rows = window?.rows ?? [];
  const filtered = Boolean(
    filters.sort !== DEFAULT_ACTIVITY_FILTERS.sort ||
      filters.action ||
      filters.committeeId ||
      filters.dateFrom ||
      filters.dateTo ||
      filters.search?.trim(),
  );
  const showClearFilters = filtered || Boolean(searchInput.trim());
  const pageNumbers = activityPageBlock(activePage, knownCursors.length);
  const pagerSlots = activityPagerSlots(pageNumbers);
  const arrowTargets = activityBlockArrowTargets(activePage);
  const previousCursor = arrowTargets.previous
    ? activityCursorForPage(knownCursors, arrowTargets.previous)
    : undefined;
  const nextCursor = activityCursorForPage(knownCursors, arrowTargets.next);
  const nextArrowBusy =
    !nextCursor && prefetching && Boolean(window?.hasMore);
  const showPager =
    activePage > 1 || Boolean(window?.hasMore) || knownCursors.length > 1;
  const safeError = navigationError ??
    (query.error ? activityErrorMessage(query.error) : null);
  const listResetKey = JSON.stringify(queryKey);
  const activeFilterCount = [
    filters.sort !== DEFAULT_ACTIVITY_FILTERS.sort,
    filters.action,
    filters.committeeId,
    filters.dateFrom,
    filters.dateTo,
  ].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 xl:grid-cols-[minmax(180px,1fr)_140px_130px_170px_145px_145px_auto_44px] xl:items-end">
        <label htmlFor="activity-log-search" className="relative">
          <span className="sr-only">Search activity</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="activity-log-search"
            value={searchInput}
            maxLength={101}
            onChange={(event) => changeSearch(event.target.value)}
            placeholder="Search activity"
            className="pl-9"
          />
        </label>
        <Button
          type="button"
          variant="outline"
          className="xl:hidden"
          aria-expanded={filtersOpen}
          aria-controls="activity-log-filters"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <SlidersHorizontal aria-hidden />
          Filters
          {activeFilterCount > 0 ? (
            <span className="ml-0.5 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {activeFilterCount}
            </span>
          ) : null}
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="xl:order-last"
          onClick={() => void refresh()}
          disabled={refreshing || navigating}
          aria-label="Refresh activity log"
          title="Refresh activity log"
        >
          <RefreshCw className={refreshing ? "animate-spin motion-reduce:animate-none" : ""} />
        </Button>
        <div
          id="activity-log-filters"
          className={cn(
            "col-span-3 grid gap-2 sm:grid-cols-2 xl:contents",
            !filtersOpen && "hidden",
          )}
        >
        <Select
          items={ACTIVITY_SORT_LABELS}
          value={filters.sort}
          onValueChange={(value) =>
            value && changeFilter({ sort: value as ActivityFilters["sort"] })
          }
        >
          <SelectTrigger className="w-full" aria-label="Sort order"><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(ACTIVITY_SORT_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={{ all: "All actions", ...ACTIVITY_ACTION_LABELS }}
          value={filters.action ?? "all"}
          onValueChange={(value) =>
            changeFilter({
              action: value === "all" ? null : value as ActivityFilters["action"],
            })
          }
        >
          <SelectTrigger className="w-full" aria-label="Filter by action"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {Object.entries(ACTIVITY_ACTION_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          items={committeeLabels}
          value={filters.committeeId ?? "all"}
          onValueChange={(value) =>
            changeFilter({ committeeId: value === "all" ? null : value })
          }
        >
          <SelectTrigger className="w-full" aria-label="Filter by committee"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All committees</SelectItem>
            {committees.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label htmlFor="activity-date-from" className="relative">
          <span className="sr-only">From date</span>
          {!filters.dateFrom ? (
            <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center text-sm text-muted-foreground" aria-hidden>
              From
            </span>
          ) : null}
          <Input
            id="activity-date-from"
            type="date"
            placeholder="From"
            aria-label="From date"
            className={!filters.dateFrom ? "text-transparent" : undefined}
            value={filters.dateFrom ?? ""}
            onChange={(event) =>
              changeFilter({ dateFrom: event.target.value || null })
            }
          />
        </label>
        <label htmlFor="activity-date-to" className="relative">
          <span className="sr-only">To date</span>
          {!filters.dateTo ? (
            <span className="pointer-events-none absolute inset-y-0 left-3 z-10 flex items-center text-sm text-muted-foreground" aria-hidden>
              To
            </span>
          ) : null}
          <Input
            id="activity-date-to"
            type="date"
            placeholder="To"
            aria-label="To date"
            className={!filters.dateTo ? "text-transparent" : undefined}
            value={filters.dateTo ?? ""}
            onChange={(event) =>
              changeFilter({ dateTo: event.target.value || null })
            }
          />
        </label>
        </div>
        {showClearFilters ? (
          <Button variant="ghost" className="col-span-3 xl:col-span-1" onClick={clearFilters}>Clear filters</Button>
        ) : (
          <span className="hidden xl:block" aria-hidden />
        )}
      </div>

      {safeError && window && !accessUnavailable ? (
        <p className="text-sm text-muted-foreground">{safeError}</p>
      ) : null}

      {validationError ? (
        <p className="text-sm text-destructive">{validationError}</p>
      ) : accessUnavailable || window?.unavailable ? (
        <EmptyState compact pose="oops" title="Activity history is unavailable" />
      ) : query.isPending ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading activity…
        </p>
      ) : safeError && !window ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {safeError}
        </p>
      ) : rows.length === 0 && window?.hasMore ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No visible activity on this page. Continue to the next known page.
        </p>
      ) : rows.length === 0 && activePage === 1 ? (
        <div className="text-center text-sm text-muted-foreground">
          <EmptyState compact pose={filtered ? "searching" : "sleeping"} title={filtered ? "No activity matches these filters." : "No activity yet."} />
          {showClearFilters ? (
            <Button variant="ghost" className="mt-2" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No activity on this page.
        </p>
      ) : (
        <ActivityLogList
          rows={rows}
          settled={!query.isFetching && !navigating}
          mode="global"
          resetKey={listResetKey}
        />
      )}

      {showPager && !accessUnavailable ? (
        <ListPager
          activePage={activePage}
          ariaLabel="Activity log pages"
          className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 mx-auto w-fit max-w-full items-center gap-3 rounded-full border bg-card/95 px-2 py-1.5 shadow-md backdrop-blur sm:mx-0 sm:w-full sm:rounded-xl sm:px-4 sm:py-2 md:bottom-3"
          navigationDisabled={navigating}
          nextBusy={nextArrowBusy}
          nextDisabled={!window?.hasMore || nextCursor === undefined}
          nextTitle={nextArrowBusy ? "Preparing next page block" : "Next page block"}
          onNext={() => void navigate(arrowTargets.next)}
          onPage={(page) => void navigate(page)}
          onPrevious={() =>
            arrowTargets.previous && void navigate(arrowTargets.previous)
          }
          pageSize={GLOBAL_ACTIVITY_LOG_PAGE_SIZE}
          previousDisabled={
            !arrowTargets.previous || previousCursor === undefined
          }
          previousTitle="Previous page block"
          slots={pagerSlots}
        />
      ) : null}
    </div>
  );
}

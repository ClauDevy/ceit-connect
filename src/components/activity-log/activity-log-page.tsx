"use client";

import { EmptyState } from "@/components/shared/empty-state";
import { MotionPresence } from "@/components/shared/motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, DatabaseZap, Download, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { ActivityLogFilterBar } from "@/components/activity-log/activity-log-filter-bar";
import { ActivityLogList } from "@/components/activity-log/activity-log-list";
import { ActivityListSkeleton } from "@/components/activity-log/activity-log-skeleton";
import { ActivityLogSummary } from "@/components/activity-log/activity-log-summary";
import { ActivityLogBackupPanel } from "@/components/activity-log/activity-log-backup-panel";
import { ListPager } from "@/components/shared/list-pager";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  ACTIVITY_LOG_EXPORT_MAX_ROWS,
  ACTIVITY_LOG_MAX_RETENTION_DAYS,
  ACTIVITY_LOG_MIN_RETENTION_DAYS,
  ACTIVITY_LOG_STALE_TIME,
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
  isValidActivityLogRetentionDays,
  isDefaultActivityFilters,
  normalizeActivitySearch,
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
import {
  activityExportRpcArgs,
  activityRowsToCsv,
  appendExportRows,
  exportLimitExceeded,
  normalizeActivityExportPage,
  normalizeActivityLogRetentionSetting,
  type ActivityLogRetentionSetting,
} from "@/lib/activity-log-admin";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type Committee = { id: string; name: string };
type Props = {
  initialWindow: ActivityWindow;
  initialLoadFailed: boolean;
  committees: Committee[];
  canManageActivityLog: boolean;
  initialRetentionSetting: ActivityLogRetentionSetting | null;
};

const GLOBAL_QUERY_PREFIX = ["activity-log", "global"] as const;

// Shortcuts that only fill the Retention days box. Nothing is saved until Save is pressed.
const RETENTION_PRESETS = [
  { days: 30, label: "1 month" },
  { days: 90, label: "3 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
] as const;

export function ActivityLogPageClient({
  initialWindow,
  initialLoadFailed,
  committees,
  canManageActivityLog,
  initialRetentionSetting,
}: Props) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
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
  const [retentionInput, setRetentionInput] = useState(
    initialRetentionSetting?.retentionDays.toString() ?? "",
  );
  const [retentionSetting, setRetentionSetting] = useState(initialRetentionSetting);
  const [savingRetention, setSavingRetention] = useState(false);
  const [retentionMessage, setRetentionMessage] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
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
      searchTimer.current = null;
      applySearch(value);
    }, 300);
  }

  function applySearch(value: string) {
    const normalizedSearch = normalizeActivitySearch(value);
    resetPaging();
    setFilters((current) => ({ ...current, search: normalizedSearch.value }));
    return normalizedSearch.value;
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

  async function saveRetention(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canManageActivityLog || savingRetention) return;
    const nextDays = Number(retentionInput);
    setRetentionMessage(null);
    setExportMessage(null);
    setExportError(null);
    setRetentionError(null);
    if (!isValidActivityLogRetentionDays(nextDays)) {
      setRetentionError("Enter a whole number from 30 to 730 days.");
      return;
    }

    setSavingRetention(true);
    try {
      const { data, error } = await supabase.rpc(
        "set_activity_log_retention_days",
        { p_retention_days: nextDays },
      );
      if (error) throw error;
      const saved = normalizeActivityLogRetentionSetting(data);
      if (!saved) throw new Error("invalid retention response");
      setRetentionSetting(saved);
      setRetentionInput(saved.retentionDays.toString());
      setRetentionMessage(
        "Retention saved. Existing rows are not deleted until a future backup run completes.",
      );
      router.refresh();
    } catch {
      setRetentionError("The retention setting could not be saved. Try again.");
    } finally {
      setSavingRetention(false);
    }
  }

  async function exportCsv() {
    if (!canManageActivityLog || exporting) return;
    let requestedSearch = filters.search;
    if (searchTimer.current) {
      clearTimeout(searchTimer.current);
      searchTimer.current = null;
      requestedSearch = applySearch(searchInput);
    }
    const requestedFilters = { ...filters, search: requestedSearch };
    let cursor: ActivityCursor | null = null;
    let exportedRows: ActivityWindow["rows"] = [];
    const seenCursors = new Set<string>();
    setExporting(true);
    setRetentionMessage(null);
    setExportError(null);
    setExportMessage("Preparing CSV…");

    try {
      while (true) {
        const { data, error } = await supabase.rpc(
          "list_activity_log_export",
          activityExportRpcArgs(requestedFilters, cursor),
        );
        if (error) throw error;
        const page = normalizeActivityExportPage(data);
        exportedRows = appendExportRows(exportedRows, page.rows);
        setExportMessage(
          `Preparing CSV… ${Math.min(exportedRows.length, ACTIVITY_LOG_EXPORT_MAX_ROWS).toLocaleString()} rows`,
        );

        if (exportLimitExceeded(exportedRows.length, page.hasMore)) {
          setExportError(
            "This export has more than 5,000 rows. Narrow the filters and try again.",
          );
          setExportMessage(null);
          return;
        }
        if (!page.hasMore) break;
        if (!page.cursor) throw new Error("missing export cursor");
        const cursorKey = `${page.cursor.createdAt}:${page.cursor.id}`;
        if (seenCursors.has(cursorKey)) throw new Error("repeated export cursor");
        seenCursors.add(cursorKey);
        cursor = page.cursor;
      }

      const csv = activityRowsToCsv(exportedRows);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const value = (type: Intl.DateTimeFormatPartTypes) =>
        parts.find((part) => part.type === type)?.value ?? "00";
      const link = document.createElement("a");
      link.href = url;
      link.download = `activity-log-${value("year")}-${value("month")}-${value("day")}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setExportMessage(
        `Downloaded ${exportedRows.length.toLocaleString()} activity rows.`,
      );
    } catch {
      setExportError("The CSV could not be prepared. Try again.");
      setExportMessage(null);
    } finally {
      setExporting(false);
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
  // The Created / Updated / Deleted chips are always visible, so they are not counted here.
  const activeFilterCount = [
    filters.sort !== DEFAULT_ACTIVITY_FILTERS.sort,
    filters.committeeId,
    filters.dateFrom,
    filters.dateTo,
  ].filter(Boolean).length;


  return (
    <div className="space-y-4">
      {canManageActivityLog ? (
        <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="activity-log-administration">
          <div className="flex items-center gap-3 p-3.5 sm:p-4">
            <span
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-accent-foreground"
              aria-hidden
            >
              <DatabaseZap className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="activity-log-administration" className="font-display text-base font-semibold">
                Retention and export
              </h2>
              {retentionSetting ? (
                <p className="text-sm text-muted-foreground">
                  Current setting: {retentionSetting.retentionDays} days.
                </p>
              ) : (
                <p className="text-sm text-destructive">
                  The current retention setting could not be loaded.
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              className="lg:hidden"
              aria-expanded={toolsOpen}
              aria-controls="activity-log-admin-tools"
              onClick={() => setToolsOpen((open) => !open)}
            >
              {toolsOpen ? "Hide" : "Manage"}
              <ChevronDown
                className={cn(
                  "transition-transform motion-reduce:transition-none",
                  toolsOpen && "rotate-180",
                )}
                aria-hidden
              />
            </Button>
          </div>
          <div
            id="activity-log-admin-tools"
            className={cn(
              "grid gap-4 border-t bg-muted/30 p-3.5 sm:p-4 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-start",
              !toolsOpen && "hidden lg:grid",
            )}
          >
            <form onSubmit={saveRetention} className="grid min-w-0 gap-3">
              <p className="text-sm text-muted-foreground">
                Keep activity for 30 to 730 days. About 6 months is 180 days.
                Saving does not delete rows immediately.
              </p>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Common retention periods">
                {RETENTION_PRESETS.map((preset) => (
                  <button
                    key={preset.days}
                    type="button"
                    aria-pressed={retentionInput === String(preset.days)}
                    disabled={savingRetention}
                    onClick={() => {
                      setRetentionInput(String(preset.days));
                      setRetentionError(null);
                      setRetentionMessage(null);
                    }}
                    className={cn(
                      "inline-flex min-h-11 items-center rounded-full border px-3.5 text-sm font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 motion-reduce:transition-none md:min-h-9",
                      retentionInput === String(preset.days)
                        ? "border-primary/50 bg-primary/10 text-accent-foreground"
                        : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {preset.label}
                    <span className="ml-1.5 text-xs opacity-70">{preset.days}d</span>
                  </button>
                ))}
              </div>
              <div className="grid gap-1.5">
                <label htmlFor="activity-retention-days" className="text-sm font-medium">
                  Retention days
                </label>
                <div className="flex gap-2">
                  <Input
                    id="activity-retention-days"
                    type="number"
                    inputMode="numeric"
                    min={ACTIVITY_LOG_MIN_RETENTION_DAYS}
                    max={ACTIVITY_LOG_MAX_RETENTION_DAYS}
                    step={1}
                    value={retentionInput}
                    disabled={savingRetention}
                    aria-invalid={retentionError ? true : undefined}
                    aria-describedby="activity-retention-help"
                    className="min-w-0 flex-1 sm:max-w-40"
                    onChange={(event) => {
                      setRetentionInput(event.target.value);
                      setRetentionError(null);
                      setRetentionMessage(null);
                    }}
                  />
                  <Button type="submit" size="lg" disabled={savingRetention || !retentionSetting}>
                    <Save aria-hidden />
                    {savingRetention ? "Saving…" : "Save"}
                  </Button>
                </div>
                <p
                  id="activity-retention-help"
                  role={retentionError ? "alert" : undefined}
                  className={cn("text-xs", retentionError ? "text-destructive" : "text-muted-foreground")}
                >
                  {retentionError ?? "Whole days only"}
                </p>
              </div>
            </form>
            <div className="grid gap-2 rounded-xl border bg-card p-3.5">
              <p className="text-sm font-semibold">Download a copy</p>
              <p className="text-xs text-muted-foreground">
                Saves a spreadsheet of up to 5,000 rows that match your current filters.
              </p>
              <Button
                type="button"
                variant="outline"
                onClick={() => void exportCsv()}
                disabled={exporting}
                className="w-full"
              >
                <Download aria-hidden />
                {exporting ? "Exporting…" : "Export CSV"}
              </Button>
            </div>
            <MotionPresence open={Boolean(retentionMessage || exportMessage || exportError)}>
              {retentionMessage || exportMessage || exportError ? (
                <div className="lg:col-span-2" aria-live="polite">
                  {exportError ? (
                    <InlineAlert>{exportError}</InlineAlert>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {retentionMessage ?? exportMessage}
                    </p>
                  )}
                </div>
              ) : null}
            </MotionPresence>
          </div>
        </section>
      ) : null}

      {canManageActivityLog ? <ActivityLogBackupPanel /> : null}

      <div className="grid grid-cols-1 gap-3">
        <ActivityLogFilterBar
          filters={filters}
          searchInput={searchInput}
          committees={committees}
          committeeLabels={committeeLabels}
          filtersOpen={filtersOpen}
          activeFilterCount={activeFilterCount}
          showClearFilters={showClearFilters}
          refreshing={refreshing}
          navigating={navigating}
          onSearchChange={changeSearch}
          onFilterChange={changeFilter}
          onToggleFilters={() => setFiltersOpen((open) => !open)}
          onClearFilters={clearFilters}
          onRefresh={() => void refresh()}
        />
      </div>

      {safeError && window && !accessUnavailable ? (
        <InlineAlert>{safeError}</InlineAlert>
      ) : null}

      {validationError ? (
        <InlineAlert>{validationError}</InlineAlert>
      ) : accessUnavailable || window?.unavailable ? (
        <EmptyState
          compact
          pose="oops"
          title="Activity history is unavailable"
          description="You may not have access right now. Try again later."
        />
      ) : query.isPending ? (
        <div role="status" aria-label="Loading activity">
          <ActivityListSkeleton />
          <span className="sr-only">Loading activity…</span>
        </div>
      ) : safeError && !window ? (
        <EmptyState
          compact
          pose="oops"
          title="We couldn’t load the activity"
          description={safeError}
          action={
            <Button variant="outline" onClick={() => void refresh()} disabled={refreshing}>
              Try again
            </Button>
          }
        />
      ) : rows.length === 0 && window?.hasMore ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No visible activity on this page. Continue to the next known page.
        </p>
      ) : rows.length === 0 && activePage === 1 ? (
        <div className="text-center text-sm text-muted-foreground">
          <EmptyState
            compact
            pose={filtered ? "searching" : "sleeping"}
            title={filtered ? "No activity matches these filters." : "No activity yet."}
            description={
              filtered
                ? "Try a different search, date range, or action."
                : "When your council creates or updates tasks and events, the changes will show up here."
            }
          />
          {showClearFilters ? (
            <Button variant="outline" className="mt-1" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No activity on this page.
        </p>
      ) : (
        <div className="grid gap-4">
          <ActivityLogSummary rows={rows} page={activePage} />
          <ActivityLogList
            rows={rows}
            settled={!query.isFetching && !navigating}
            mode="global"
            resetKey={listResetKey}
          />
        </div>
      )}

      {showPager && !accessUnavailable ? (
        <ListPager
          activePage={activePage}
          ariaLabel="Activity log pages"
          className="items-center gap-3 rounded-2xl border bg-card px-3 py-2 shadow-xs sm:px-4"
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

"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { ActivityLogList } from "@/components/activity-log/activity-log-list";
import { ListPager } from "@/components/shared/list-pager";
import { Collapse } from "@/components/shared/motion";
import { Button } from "@/components/ui/button";
import {
  ACTIVITY_LOG_STALE_TIME,
  DEFAULT_ACTIVITY_FILTERS,
  TASK_HISTORY_PAGE_SIZE,
  activityBlockArrowTargets,
  activityCursorForPage,
  activityErrorCode,
  activityErrorMessage,
  activityFiltersToRpc,
  activityLogRetentionNotice,
  activityPageBlock,
  activityPagerSlots,
  createTaskHistoryController,
  normalizeActivityResponse,
  prefetchTaskHistoryPageChain,
  resetActivityCursorStack,
  taskHistoryOlderPageFailure,
  taskHistoryKnownCursorsAfterPage,
  taskHistoryPagerVisible,
  taskHistoryToggleCommand,
  type ActivityCursor,
  type ActivityCursorStack,
  type ActivityPage,
} from "@/lib/activity-log";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type RequestReason = "initial" | "navigation" | "refresh" | "focus";

const EMPTY_PAGE: ActivityPage = { rows: [], hasMore: false, cursor: null };

export function TaskHistory({ taskId }: { taskId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [controller] = useState(() => createTaskHistoryController());
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState<ActivityPage | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [knownCursors, setKnownCursors] = useState<ActivityCursorStack>(
    resetActivityCursorStack,
  );
  const knownCursorsRef = useRef<ActivityCursorStack>(resetActivityCursorStack());
  const [busyReason, setBusyReason] = useState<RequestReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  async function readPage(cursor: ActivityCursor | null): Promise<ActivityPage> {
    const { data, error: readError } = await supabase.rpc(
      "list_activity_log",
      activityFiltersToRpc(
        DEFAULT_ACTIVITY_FILTERS,
        cursor,
        taskId,
        TASK_HISTORY_PAGE_SIZE,
      ),
    );
    if (readError) throw readError;
    return normalizeActivityResponse(data);
  }

  function commitPage(
    nextPage: ActivityPage,
    targetPage: number,
    resetPagesAhead = false,
  ) {
    setPage(nextPage);
    setActivePage(targetPage);
    setUnavailable(false);
    const nextCursors = taskHistoryKnownCursorsAfterPage(
      knownCursorsRef.current,
      targetPage,
      nextPage,
      resetPagesAhead,
    );
    knownCursorsRef.current = nextCursors;
    setKnownCursors(nextCursors);
  }

  async function runPrefetch(nextPage: ActivityPage, targetPage: number) {
    const result = await prefetchTaskHistoryPageChain({
      controller,
      initialPage: nextPage,
      initialPageNumber: targetPage,
      knownCursors: knownCursorsRef.current,
      fetchPage: readPage,
    });
    if (!result.accepted) return;
    knownCursorsRef.current = result.knownCursors;
    setKnownCursors(result.knownCursors);
  }

  async function runRequest({
    requestToken,
    cursor,
    targetPage,
    reason,
  }: {
    requestToken: number;
    cursor: ActivityCursor | null;
    targetPage: number;
    reason: RequestReason;
  }) {
    if (!controller.isCurrent(requestToken)) return;
    setBusyReason(reason);
    setError(null);
    try {
      const nextPage = await readPage(cursor);
      if (!controller.settle(requestToken, true, Date.now())) return;

      controller.rememberVisiblePage(targetPage, nextPage);
      commitPage(
        nextPage,
        targetPage,
        reason === "refresh" || reason === "focus",
      );
      setBusyReason(null);
      void runPrefetch(nextPage, targetPage);
    } catch (requestError) {
      if (!controller.isCurrent(requestToken)) return;
      if (activityErrorCode(requestError) === "CAL01") {
        if (!controller.settle(requestToken, true, Date.now())) return;
        setPage(EMPTY_PAGE);
        setActivePage(1);
        const resetCursors = resetActivityCursorStack();
        knownCursorsRef.current = resetCursors;
        setKnownCursors(resetCursors);
        setUnavailable(true);
        setError(null);
      } else {
        if (!controller.settle(requestToken, false, Date.now())) return;
        setError(
          reason === "navigation"
            ? taskHistoryOlderPageFailure(requestError).message
            : reason === "initial"
              ? activityErrorMessage(requestError)
              : "History could not refresh. The previous results are still shown.",
        );
      }
      setBusyReason(null);
    }
  }

  function toggleExpanded() {
    const transition = taskHistoryToggleCommand(controller);
    setExpanded(transition.expanded);
    if (transition.requestToken !== null) {
      void runRequest({
        requestToken: transition.requestToken,
        cursor: null,
        targetPage: 1,
        reason: "initial",
      });
    } else if (transition.expanded && page) {
      void runPrefetch(page, activePage);
    }
  }

  function navigate(targetPage: number) {
    if (busyReason !== null || targetPage === activePage) return;
    const cursor = activityCursorForPage(knownCursors, targetPage);
    if (cursor === undefined) return;
    const command = controller.beginNavigationCommand(targetPage, cursor);
    if (!command) return;
    if (command.type === "cached") {
      setError(null);
      commitPage(command.page, targetPage);
      void runPrefetch(command.page, targetPage);
      return;
    }
    void runRequest({
      requestToken: command.requestToken,
      cursor,
      targetPage,
      reason: "navigation",
    });
  }

  function refresh() {
    if (busyReason !== null) return;
    const cursor = activityCursorForPage(knownCursors, activePage);
    const requestToken =
      cursor === undefined
        ? null
        : controller.beginManualRefresh(activePage, cursor);
    if (requestToken === null || cursor === undefined) return;
    void runRequest({ requestToken, cursor, targetPage: activePage, reason: "refresh" });
  }

  useEffect(() => {
    function refreshOnFocus() {
      if (document.visibilityState === "hidden") return;
      const cursor = activityCursorForPage(knownCursors, activePage);
      if (cursor === undefined) return;
      const requestToken = controller.beginFocusRefresh(
        Date.now(),
        ACTIVITY_LOG_STALE_TIME,
        activePage,
        cursor,
      );
      if (requestToken === null) return;
      void runRequest({ requestToken, cursor, targetPage: activePage, reason: "focus" });
    }

    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  });

  const applyMountCommand = useEffectEvent(() => {
    const command = controller.mount();
    if (!command) return;
    queueMicrotask(() => {
      if (command.type === "clear-busy") {
        setBusyReason(null);
        return;
      }
      void runRequest(command.request);
    });
  });

  useEffect(() => {
    applyMountCommand();
    return () => {
      controller.unmount();
    };
  }, [controller]);

  const pageNumbers = activityPageBlock(activePage, knownCursors.length);
  const pagerSlots = activityPagerSlots(pageNumbers);
  const arrowTargets = activityBlockArrowTargets(activePage);
  const previousCursor = arrowTargets.previous
    ? activityCursorForPage(knownCursors, arrowTargets.previous)
    : undefined;
  const nextCursor = activityCursorForPage(knownCursors, arrowTargets.next);
  const showPager = taskHistoryPagerVisible(
    activePage,
    Boolean(page?.hasMore),
    knownCursors.length,
  );
  const contentId = `task-history-${taskId}`;

  return (
    <section
      className="overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
      aria-labelledby="task-history-heading"
    >
      <h2 id="task-history-heading">
        <button
          type="button"
          className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left font-display text-lg font-semibold outline-none transition-colors hover:bg-muted active:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset motion-reduce:transition-none sm:px-5"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={toggleExpanded}
        >
          <span>History</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-panel-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        </button>
      </h2>

      <Collapse open={expanded}>
        <div id={contentId} className="space-y-3 border-t px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {activityLogRetentionNotice()}
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              disabled={busyReason !== null || page === null}
            >
              <RefreshCw
                aria-hidden
                className={cn(busyReason === "refresh" && "motion-safe:animate-spin")}
              />
              {busyReason === "refresh" ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          {error ? <p className="text-sm text-muted-foreground">{error}</p> : null}
          {busyReason === "initial" && page === null ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading history…
            </p>
          ) : unavailable ? (
            <p className="text-sm text-muted-foreground">
              Activity history is unavailable.
            </p>
          ) : page?.rows.length ? (
            <ActivityLogList rows={page.rows} settled={busyReason === null} />
          ) : page ? (
            <p className="text-sm text-muted-foreground">No task history yet.</p>
          ) : error ? null : (
            <p className="text-sm text-muted-foreground">Open History to load activity.</p>
          )}

          {showPager && !unavailable ? (
            <ListPager
              activePage={activePage}
              ariaLabel="Task history pages"
              navigationDisabled={busyReason !== null}
              nextDisabled={!page?.hasMore || nextCursor === undefined}
              onNext={() => navigate(arrowTargets.next)}
              onPage={navigate}
              onPrevious={() =>
                arrowTargets.previous && navigate(arrowTargets.previous)
              }
              pageSize={TASK_HISTORY_PAGE_SIZE}
              previousDisabled={
                !arrowTargets.previous || previousCursor === undefined
              }
              slots={pagerSlots}
            />
          ) : null}
        </div>
      </Collapse>
    </section>
  );
}

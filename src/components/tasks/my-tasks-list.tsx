"use client";

import { useCallback, useEffect, useMemo } from "react";
import {
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadMoreControl } from "@/components/shared/load-more-control";
import { useListReveal } from "@/components/shared/motion";
import {
  getPriorityAccentClass,
  PriorityBadge,
} from "@/components/shared/priority-badge";
import { StretchedLink } from "@/components/shared/stretched-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useOffsetListPaging } from "@/hooks/use-offset-list-paging";
import type { OffsetListPage } from "@/lib/list-paging";
import {
  getLoadedMyTasksCount,
  getMyTasksErrorMessage,
  getMyTasksRpcArgs,
  isMyTask,
  type MyTask,
  type MyTasksSort,
  type MyTasksStatus,
} from "@/lib/tasks/my-tasks";
import { createClient } from "@/lib/supabase/client";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const POLL_INTERVAL_MS = 15_000;

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

function sortDescription(sort: MyTasksSort) {
  if (sort === "priority") return "Sorted by effective priority";
  if (sort === "event") return "Sorted by event name";
  return "Sorted by closest deadline";
}

type LoadedState = { count: number; hasNextPage: boolean };

function MyTasksContents({
  initialPage,
  active,
  status,
  sort,
  onLoadedStateChange,
}: {
  initialPage?: OffsetListPage<MyTask>;
  active: boolean;
  status: MyTasksStatus;
  sort: MyTasksSort;
  onLoadedStateChange?: (state: LoadedState) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const canUseInitialTasks = status === null && sort === "deadline";
  const fetchPage = useCallback(
    async (offset: number, signal: AbortSignal) => {
      let request = supabase.rpc(
        "list_my_tasks",
        getMyTasksRpcArgs(status, sort, offset),
      );
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isMyTask)) {
        throw new Error("The My Tasks reader returned an invalid response.");
      }
      return data;
    },
    [sort, status, supabase],
  );

  const paging = useOffsetListPaging({
    active,
    fetchPage,
    getId: (task: MyTask) => task.out_id,
    identity: `my-tasks:${status ?? "all"}:${sort}`,
    initialPage: canUseInitialTasks ? initialPage : undefined,
    pollIntervalMs: POLL_INTERVAL_MS,
    singularLabel: "task",
    pluralLabel: "tasks",
  });

  const tasks = paging.items;
  const reveal = useListReveal({
    initialItems: canUseInitialTasks ? initialPage?.items : undefined,
    items: tasks,
    settled: paging.settled,
    error: paging.error,
    waitForSuccessfulData: true,
    getId: (task: MyTask) => task.out_id,
  });
  const loadedCount = getLoadedMyTasksCount(tasks);
  const hasNextPage = paging.hasMore;
  const hideTaskList =
    !paging.settled || (paging.error !== null && tasks.length === 0);

  useEffect(() => {
    if (!active || status !== null || !paging.settled || paging.isRefreshing)
      return;
    onLoadedStateChange?.({ count: loadedCount, hasNextPage });
  }, [
    hasNextPage,
    active,
    loadedCount,
    onLoadedStateChange,
    paging.isRefreshing,
    paging.settled,
    status,
  ]);

  if (paging.isInitialLoading) {
    return (
      <Card
        className="overflow-hidden"
        role="status"
        aria-label="Loading your tasks"
      >
        <div className="divide-y" aria-hidden>
          {[0, 1, 2].map((item) => (
            <div key={item} className="space-y-2.5 px-4 py-3.5 sm:px-5">
              <div className="flex gap-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          ))}
        </div>
        <span className="sr-only">Loading your tasks…</span>
      </Card>
    );
  }

  return (
    <div className="space-y-3" aria-busy={paging.isRefreshing}>
      <p className="text-xs text-muted-foreground">
        {paging.isRefreshing ? (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5"
          >
            <LoaderCircle className="size-3.5 motion-safe:animate-spin" aria-hidden />
            Updating…
          </span>
        ) : (
          <>
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"} loaded ·{" "}
            {sortDescription(sort).toLowerCase()}
          </>
        )}
      </p>

      {paging.error && paging.failedMode !== "append" ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {getMyTasksErrorMessage(paging.error)}
            {tasks.length === 0
              ? ""
              : " The last successful result is still shown."}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void paging.retry()}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </InlineAlert>
      ) : null}

      {hideTaskList ? null : tasks.length === 0 ? (
        <Card className="border-dashed">
          <EmptyState
            title={status ? "No tasks match this status" : "No tasks assigned"}
            description={
              status
                ? "Choose another status to see more of your assigned work."
                : "Primary and assist assignments from active events will appear here."
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y">
            {tasks.map((task) => (
              <div
                key={task.out_id}
                {...reveal.getRevealProps(task.out_id)}
                className={cn(
                  `motion-card-interaction group relative border-l-4 ${getPriorityAccentClass(task.out_effective_priority)} hover:bg-muted/40 focus-within:bg-muted/40`,
                )}
              >
                <StretchedLink
                  href={`/tasks/${task.out_id}`}
                  label={`Open ${task.out_title}`}
                  className="transition-colors duration-[var(--motion-interaction-duration)] active:bg-muted/60 motion-reduce:transition-none"
                />
                <CardContent className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Badge variant="outline">{task.out_status}</Badge>
                      <p className="min-w-0 text-sm font-semibold sm:text-base">
                        {task.out_title}
                      </p>
                      {task.out_request_backup ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <TriangleAlert className="size-3.5" aria-hidden />{" "}
                          Help Wanted
                        </span>
                      ) : null}
                      <PriorityBadge priority={task.out_effective_priority} />
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {task.out_event_name} · {task.out_committee_name} ·{" "}
                      {task.out_status === "Completed"
                        ? "Completed"
                        : task.out_due_date
                          ? `Due ${dueDateFormatter.format(new Date(task.out_due_date))}`
                          : "No deadline"}
                    </p>
                  </div>
                  <ChevronRight
                    className="motion-arrow size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                    aria-hidden
                  />
                </CardContent>
              </div>
            ))}
          </div>
        </Card>
      )}

      <LoadMoreControl
        announcement={paging.announcement}
        disabled={paging.isRefreshing}
        errorMessage={
          paging.error && paging.failedMode === "append"
            ? `${getMyTasksErrorMessage(paging.error)} The loaded tasks are still shown.`
            : undefined
        }
        hasLoadedMore={paging.hasLoadedMore}
        hasMore={paging.hasMore}
        isLoading={paging.isLoadingMore}
        onLoadMore={() => void paging.loadMore()}
        onRetry={() => void paging.retry()}
      />
    </div>
  );
}

export function MyTasksList({
  initialPage,
  active,
  status,
  sort,
  onLoadedStateChange,
}: {
  initialPage?: OffsetListPage<MyTask>;
  active: boolean;
  status: MyTasksStatus;
  sort: MyTasksSort;
  onLoadedStateChange?: (state: LoadedState) => void;
}) {
  return (
    <MyTasksContents
      initialPage={initialPage}
      active={active}
      status={status}
      sort={sort}
      onLoadedStateChange={onLoadedStateChange}
    />
  );
}

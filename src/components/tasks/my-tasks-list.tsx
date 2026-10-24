"use client";

import { useEffect, useMemo, useState } from "react";
import {
  keepPreviousData,
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
} from "@tanstack/react-query";
import {
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { StretchedLink } from "@/components/shared/stretched-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MY_TASKS_PAGE_SIZE,
  dedupeMyTasks,
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

const POLL_INTERVAL_MS = 15_000;

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

function priorityAccent(priority: MyTask["out_effective_priority"]) {
  if (priority === "Critical") return "border-l-destructive";
  if (priority === "High") return "border-l-primary";
  if (priority === "Medium") return "border-l-secondary-foreground";
  return "border-l-muted-foreground";
}

function sortDescription(sort: MyTasksSort) {
  if (sort === "priority") return "Sorted by effective priority";
  if (sort === "event") return "Sorted by event name";
  return "Sorted by closest deadline";
}

type LoadedState = { count: number; hasNextPage: boolean };

function MyTasksContents({
  initialTasks,
  active,
  status,
  sort,
  onLoadedStateChange,
}: {
  initialTasks?: MyTask[];
  active: boolean;
  status: MyTasksStatus;
  sort: MyTasksSort;
  onLoadedStateChange?: (state: LoadedState) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const canUseInitialTasks = status === null && sort === "deadline";

  const query = useInfiniteQuery({
    queryKey: ["my-tasks", status, sort],
    queryFn: async ({ pageParam, signal }) => {
      let request = supabase.rpc(
        "list_my_tasks",
        getMyTasksRpcArgs(status, sort, pageParam),
      );
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isMyTask)) {
        throw new Error("The My Tasks reader returned an invalid response.");
      }
      return data;
    },
    initialPageParam: 0,
    initialData:
      initialTasks === undefined || !canUseInitialTasks
        ? undefined
        : { pages: [initialTasks], pageParams: [0] },
    placeholderData: keepPreviousData,
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.length === MY_TASKS_PAGE_SIZE
        ? lastPageParam + MY_TASKS_PAGE_SIZE
        : undefined,
    enabled: active,
    refetchOnWindowFocus: active,
    refetchInterval: active ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });

  const tasks = useMemo(
    () => dedupeMyTasks(query.data?.pages ?? []),
    [query.data],
  );
  const loadedCount = getLoadedMyTasksCount(tasks);
  const hasNextPage = query.hasNextPage === true;

  useEffect(() => {
    if (status !== null || query.isPending || query.isPlaceholderData) return;
    onLoadedStateChange?.({ count: loadedCount, hasNextPage });
  }, [
    hasNextPage,
    loadedCount,
    onLoadedStateChange,
    query.isPending,
    query.isPlaceholderData,
    status,
  ]);

  if (query.isPending) {
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
    <div className="space-y-3" aria-busy={query.isPlaceholderData}>
      <p className="text-xs text-muted-foreground">
        {query.isPlaceholderData ? (
          <span
            role="status"
            aria-live="polite"
            className="inline-flex items-center gap-1.5"
          >
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden />
            Updating…
          </span>
        ) : (
          <>
            {tasks.length} {tasks.length === 1 ? "task" : "tasks"} loaded ·{" "}
            {sortDescription(sort).toLowerCase()}
          </>
        )}
      </p>

      {query.error ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {getMyTasksErrorMessage(query.error)}
            {query.data === undefined
              ? ""
              : " The last successful result is still shown."}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </InlineAlert>
      ) : null}

      {query.data === undefined ? null : tasks.length === 0 ? (
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
                className={`group relative border-l-4 ${priorityAccent(task.out_effective_priority)} transition-colors duration-150 hover:bg-muted/40 focus-within:bg-muted/40 motion-reduce:transition-none`}
              >
                <StretchedLink
                  href={`/tasks/${task.out_id}`}
                  label={`Open ${task.out_title}`}
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
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {task.out_effective_priority} · {task.out_event_name} ·{" "}
                      {task.out_committee_name} ·{" "}
                      {task.out_status === "Completed"
                        ? "Completed"
                        : task.out_due_date
                          ? `Due ${dueDateFormatter.format(new Date(task.out_due_date))}`
                          : "No deadline"}
                    </p>
                  </div>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                    aria-hidden
                  />
                </CardContent>
              </div>
            ))}
          </div>
        </Card>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetchingNextPage || query.isPlaceholderData}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : null}
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function MyTasksList({
  initialTasks,
  active,
  status,
  sort,
  onLoadedStateChange,
}: {
  initialTasks?: MyTask[];
  active: boolean;
  status: MyTasksStatus;
  sort: MyTasksSort;
  onLoadedStateChange?: (state: LoadedState) => void;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <MyTasksContents
        initialTasks={initialTasks}
        active={active}
        status={status}
        sort={sort}
        onLoadedStateChange={onLoadedStateChange}
      />
    </QueryClientProvider>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { LoaderCircle, RefreshCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MY_TASKS_PAGE_SIZE,
  dedupeMyTasks,
  getLoadedMyTasksCount,
  getMyTasksErrorMessage,
  getMyTasksRpcArgs,
  isMyTask,
  isMyTasksSort,
  isMyTasksStatus,
  type MyTask,
  type MyTasksSort,
  type MyTasksStatus,
} from "@/lib/tasks/my-tasks";
import { createClient } from "@/lib/supabase/client";
import { APP_TIME_ZONE } from "@/lib/timezone";

const POLL_INTERVAL_MS = 15_000;

const statusItems = [
  { value: "all", label: "All statuses" },
  { value: "To Do", label: "To Do" },
  { value: "In Progress", label: "In Progress" },
  { value: "Completed", label: "Completed" },
];

const sortItems = [
  { value: "deadline", label: "Deadline" },
  { value: "priority", label: "Priority" },
  { value: "event", label: "Event" },
];

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

function priorityVariant(priority: MyTask["out_effective_priority"]) {
  if (priority === "Critical") return "destructive" as const;
  if (priority === "High") return "outline" as const;
  return "neutral" as const;
}

function assignmentLabel(task: MyTask) {
  if (task.out_is_primary && task.out_is_assist) return "Primary and assist";
  if (task.out_is_primary) return "Primary assignment";
  return "Assist assignment";
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
  onLoadedStateChange,
}: {
  initialTasks?: MyTask[];
  active: boolean;
  onLoadedStateChange?: (state: LoadedState) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<MyTasksStatus>(null);
  const [sort, setSort] = useState<MyTasksSort>("deadline");
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
    onLoadedStateChange?.({ count: loadedCount, hasNextPage });
  }, [hasNextPage, loadedCount, onLoadedStateChange]);

  if (query.isPending) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <LoaderCircle className="animate-spin" aria-hidden /> Loading your
        tasks…
      </div>
    );
  }

  if (query.error && query.data === undefined) {
    return (
      <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
        <span>{getMyTasksErrorMessage(query.error)}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
        >
          <RefreshCw aria-hidden /> Retry
        </Button>
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {sortDescription(sort)} · {tasks.length} loaded
        </p>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <div className="space-y-1">
            <label
              htmlFor="my-tasks-status"
              className="block text-xs font-medium text-muted-foreground"
            >
              Status
            </label>
            <Select
              items={statusItems}
              value={status ?? "all"}
              onValueChange={(value) => {
                if (value === "all") setStatus(null);
                else if (isMyTasksStatus(value)) setStatus(value);
              }}
            >
              <SelectTrigger id="my-tasks-status" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label
              htmlFor="my-tasks-sort"
              className="block text-xs font-medium text-muted-foreground"
            >
              Sort
            </label>
            <Select
              items={sortItems}
              value={sort}
              onValueChange={(value) => {
                if (isMyTasksSort(value)) setSort(value);
              }}
            >
              <SelectTrigger id="my-tasks-sort" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sortItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {query.error ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {getMyTasksErrorMessage(query.error)} The last successful result is
            still shown.
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

      {tasks.length === 0 ? (
        <Card>
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
        <div className="space-y-3">
          {tasks.map((task) => (
            <Card key={task.out_id} className="p-0">
              <CardContent className="p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{task.out_status}</Badge>
                  <Badge variant={priorityVariant(task.out_effective_priority)}>
                    {task.out_effective_priority}
                  </Badge>
                  {task.out_request_backup ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <TriangleAlert className="size-3.5" aria-hidden /> Help
                      Wanted
                    </span>
                  ) : null}
                </div>
                <Link
                  href={`/tasks/${task.out_id}`}
                  className="rounded-sm text-sm font-semibold hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {task.out_title}
                </Link>
                <p className="mt-1 text-xs text-muted-foreground">
                  {task.out_event_name} · {task.out_committee_name} ·{" "}
                  {task.out_phase?.trim() || "Unphased"}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>{assignmentLabel(task)}</span>
                  <span>
                    {task.out_status === "Completed"
                      ? "Completed"
                      : task.out_due_date
                        ? `Due ${dueDateFormatter.format(new Date(task.out_due_date))}`
                        : "No deadline"}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetchingNextPage}
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
  onLoadedStateChange,
}: {
  initialTasks?: MyTask[];
  active: boolean;
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
        onLoadedStateChange={onLoadedStateChange}
      />
    </QueryClientProvider>
  );
}

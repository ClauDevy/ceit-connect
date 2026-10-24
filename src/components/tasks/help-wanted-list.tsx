"use client";

import { useEffect, useMemo, useState } from "react";
import {
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
  HELP_WANTED_PAGE_SIZE,
  getTaskBackupErrorMessage,
  isHelpWantedTask,
  isVolunteerTaskResult,
  isWithdrawVolunteerResult,
  type HelpWantedTask,
} from "@/lib/tasks/backup";
import { createClient } from "@/lib/supabase/client";
import { APP_TIME_ZONE } from "@/lib/timezone";

const POLL_INTERVAL_MS = 15_000;

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

function priorityAccent(priority: HelpWantedTask["out_effective_priority"]) {
  if (priority === "Critical") return "border-l-destructive";
  if (priority === "High") return "border-l-primary";
  if (priority === "Medium") return "border-l-secondary-foreground";
  return "border-l-muted-foreground";
}

function HelpWantedContents({
  initialTasks,
  active,
  onLoadedStateChange,
}: {
  initialTasks?: HelpWantedTask[];
  active: boolean;
  onLoadedStateChange?: (state: {
    count: number;
    hasNextPage: boolean;
  }) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ["help-wanted-tasks"],
    queryFn: async ({ pageParam, signal }) => {
      let request = supabase.rpc("list_help_wanted_tasks", {
        p_limit: HELP_WANTED_PAGE_SIZE,
        p_offset: pageParam,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isHelpWantedTask)) {
        throw new Error("The Help Wanted reader returned an invalid response.");
      }
      return data;
    },
    initialPageParam: 0,
    initialData:
      initialTasks === undefined
        ? undefined
        : { pages: [initialTasks], pageParams: [0] },
    getNextPageParam: (lastPage, _pages, lastPageParam) =>
      lastPage.length === HELP_WANTED_PAGE_SIZE
        ? lastPageParam + HELP_WANTED_PAGE_SIZE
        : undefined,
    enabled: active,
    refetchOnWindowFocus: active,
    refetchInterval: active ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
  });

  const tasks = useMemo(() => {
    const byId = new Map<string, HelpWantedTask>();
    for (const task of query.data?.pages.flat() ?? []) {
      byId.set(task.out_id, task);
    }
    return [...byId.values()];
  }, [query.data]);

  useEffect(() => {
    onLoadedStateChange?.({
      count: tasks.length,
      hasNextPage: query.hasNextPage === true,
    });
  }, [onLoadedStateChange, query.hasNextPage, tasks.length]);

  async function volunteer(taskId: string) {
    if (busyTaskId) return;
    setBusyTaskId(taskId);
    setActionError(null);
    setActionNotice(null);
    try {
      const { data, error } = await supabase.rpc("volunteer_for_task", {
        p_task_id: taskId,
      });
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isVolunteerTaskResult(data[0])
      ) {
        throw new Error("The volunteer writer returned an invalid response.");
      }
      setActionNotice("You volunteered to help.");
    } catch (error) {
      setActionError(getTaskBackupErrorMessage("volunteer", error));
    } finally {
      try {
        await query.refetch();
      } finally {
        setBusyTaskId(null);
      }
    }
  }

  async function withdraw(taskId: string) {
    if (busyTaskId) return;
    setBusyTaskId(taskId);
    setActionError(null);
    setActionNotice(null);
    try {
      const { data, error } = await supabase.rpc("withdraw_task_volunteer", {
        p_task_id: taskId,
      });
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isWithdrawVolunteerResult(data[0])
      ) {
        throw new Error("The withdrawal writer returned an invalid response.");
      }
      setActionNotice("Your volunteer offer was withdrawn.");
    } catch (error) {
      setActionError(getTaskBackupErrorMessage("withdraw", error));
    } finally {
      try {
        await query.refetch();
      } finally {
        setBusyTaskId(null);
      }
    }
  }

  if (query.isPending) {
    return (
      <Card
        className="overflow-hidden"
        role="status"
        aria-label="Loading Help Wanted tasks"
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
        <span className="sr-only">Loading Help Wanted tasks…</span>
      </Card>
    );
  }

  if (query.error && query.data === undefined) {
    return (
      <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
        <span>Help Wanted tasks could not be loaded.</span>
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
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {tasks.length} {tasks.length === 1 ? "task" : "tasks"} loaded
      </p>

      <div aria-live="polite" aria-atomic="true">
        {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
        {actionNotice ? (
          <p role="status" className="text-sm text-muted-foreground">
            {actionNotice}
          </p>
        ) : null}
      </div>

      {query.error ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Help Wanted tasks could not refresh. The last successful result is
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
        <Card className="border-dashed">
          <EmptyState
            title="No tasks need backup"
            description="When someone requests help on an active task you can access, it will appear here."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="divide-y">
            {tasks.map((task) => {
              const busy = busyTaskId === task.out_id;
              return (
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
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <TriangleAlert className="size-3.5" aria-hidden />{" "}
                          Help Wanted
                        </span>
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {task.out_effective_priority} · {task.out_event_name} ·{" "}
                        {task.out_committee_name} ·{" "}
                        {task.out_due_date
                          ? `Due ${dueDateFormatter.format(new Date(task.out_due_date))}`
                          : "No deadline"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {task.out_has_volunteered ? (
                        <div className="relative z-20">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            disabled={busyTaskId !== null}
                            onClick={() => void withdraw(task.out_id)}
                          >
                            {busy ? (
                              <LoaderCircle
                                className="animate-spin"
                                aria-hidden
                              />
                            ) : null}
                            Withdraw
                          </Button>
                        </div>
                      ) : task.out_can_volunteer ? (
                        <div className="relative z-20">
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full sm:w-auto"
                            disabled={busyTaskId !== null}
                            onClick={() => void volunteer(task.out_id)}
                          >
                            {busy ? (
                              <LoaderCircle
                                className="animate-spin"
                                aria-hidden
                              />
                            ) : null}
                            Volunteer
                          </Button>
                        </div>
                      ) : null}
                      <ChevronRight
                        className="size-4 text-muted-foreground transition-[color,transform] duration-150 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                        aria-hidden
                      />
                    </div>
                  </CardContent>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {query.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetchingNextPage || busyTaskId !== null}
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

export function HelpWantedList({
  initialTasks,
  active = true,
  onLoadedStateChange,
}: {
  initialTasks?: HelpWantedTask[];
  active?: boolean;
  onLoadedStateChange?: (state: {
    count: number;
    hasNextPage: boolean;
  }) => void;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HelpWantedContents
        initialTasks={initialTasks}
        active={active}
        onLoadedStateChange={onLoadedStateChange}
      />
    </QueryClientProvider>
  );
}

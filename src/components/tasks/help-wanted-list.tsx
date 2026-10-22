"use client";

import { useMemo, useState } from "react";
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

function priorityVariant(priority: HelpWantedTask["out_effective_priority"]) {
  if (priority === "Critical") return "destructive" as const;
  if (priority === "High") return "outline" as const;
  return "neutral" as const;
}

function HelpWantedContents({
  initialTasks,
}: {
  initialTasks?: HelpWantedTask[];
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
    refetchOnWindowFocus: true,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const tasks = useMemo(() => {
    const byId = new Map<string, HelpWantedTask>();
    for (const task of query.data?.pages.flat() ?? []) {
      byId.set(task.out_id, task);
    }
    return [...byId.values()];
  }, [query.data]);

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
      const { data, error } = await supabase.rpc(
        "withdraw_task_volunteer",
        { p_task_id: taskId },
      );
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
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <LoaderCircle className="animate-spin" aria-hidden /> Loading Help
        Wanted tasks…
      </div>
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
    <div className="space-y-4">
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
        <Card>
          <EmptyState
            title="No tasks need backup"
            description="When someone requests help on an active task you can access, it will appear here."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const busy = busyTaskId === task.out_id;
            return (
              <Card key={task.out_id} className="p-0">
                <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{task.out_status}</Badge>
                      <Badge variant={priorityVariant(task.out_effective_priority)}>
                        {task.out_effective_priority}
                      </Badge>
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                        <TriangleAlert className="size-3.5" aria-hidden /> Help
                        Wanted
                      </span>
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      {task.out_due_date
                        ? `Due ${dueDateFormatter.format(new Date(task.out_due_date))}`
                        : "No deadline"}
                    </p>
                  </div>
                  {task.out_has_volunteered ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={busyTaskId !== null}
                      onClick={() => void withdraw(task.out_id)}
                    >
                      {busy ? (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      ) : null}
                      Withdraw
                    </Button>
                  ) : task.out_can_volunteer ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="shrink-0"
                      disabled={busyTaskId !== null}
                      onClick={() => void volunteer(task.out_id)}
                    >
                      {busy ? (
                        <LoaderCircle className="animate-spin" aria-hidden />
                      ) : null}
                      Volunteer
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
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
}: {
  initialTasks?: HelpWantedTask[];
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1 } },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <HelpWantedContents initialTasks={initialTasks} />
    </QueryClientProvider>
  );
}

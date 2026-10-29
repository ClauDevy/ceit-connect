"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  getHelpWantedRpcArgs,
  getTaskBackupErrorMessage,
  isHelpWantedTask,
  isVolunteerTaskResult,
  isWithdrawVolunteerResult,
  type HelpWantedTask,
} from "@/lib/tasks/backup";
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

function HelpWantedContents({
  viewerRole,
  initialPage,
  active,
  onLoadedStateChange,
}: {
  viewerRole: "Admin" | "Co-Admin" | "Member";
  initialPage?: OffsetListPage<HelpWantedTask>;
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
  const fetchPage = useCallback(
    async (offset: number, signal: AbortSignal) => {
      let request = supabase.rpc(
        "list_help_wanted_tasks",
        getHelpWantedRpcArgs(offset),
      );
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isHelpWantedTask)) {
        throw new Error("The Help Wanted reader returned an invalid response.");
      }
      return data;
    },
    [supabase],
  );
  const paging = useOffsetListPaging({
    active,
    fetchPage,
    getId: (task: HelpWantedTask) => task.out_id,
    identity: "help-wanted",
    initialPage,
    paused: busyTaskId !== null,
    pollIntervalMs: POLL_INTERVAL_MS,
    singularLabel: "task",
    pluralLabel: "tasks",
  });
  const tasks = paging.items;
  const reveal = useListReveal({
    initialItems: initialPage?.items,
    items: tasks,
    settled: paging.settled,
    error: paging.error,
    waitForSuccessfulData: true,
    getId: (task: HelpWantedTask) => task.out_id,
  });

  useEffect(() => {
    if (!active || !paging.settled || paging.isRefreshing) return;
    onLoadedStateChange?.({
      count: tasks.length,
      hasNextPage: paging.hasMore,
    });
  }, [
    onLoadedStateChange,
    active,
    paging.hasMore,
    paging.isRefreshing,
    paging.settled,
    tasks.length,
  ]);

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
      setActionNotice(
        viewerRole === "Member"
          ? "Your volunteer offer was sent."
          : "You are now helping with this task.",
      );
    } catch (error) {
      setActionError(getTaskBackupErrorMessage("volunteer", error));
    } finally {
      try {
        await paging.refreshFromStart();
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
        await paging.refreshFromStart();
      } finally {
        setBusyTaskId(null);
      }
    }
  }

  if (paging.isInitialLoading) {
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

  if (paging.error && tasks.length === 0) {
    return (
      <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
        <span>Help Wanted tasks could not be loaded.</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void paging.retry()}
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

      {paging.error && paging.failedMode !== "append" ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Help Wanted tasks could not refresh. The last successful result is
            still shown.
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

      {paging.settled && tasks.length === 0 ? (
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
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                          <TriangleAlert className="size-3.5" aria-hidden />{" "}
                          Help Wanted
                        </span>
                        <PriorityBadge priority={task.out_effective_priority} />
                      </div>
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        {task.out_event_name} · {task.out_committee_name} ·{" "}
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
                                className="motion-safe:animate-spin"
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
                                className="motion-safe:animate-spin"
                                aria-hidden
                              />
                            ) : null}
                            Volunteer
                          </Button>
                        </div>
                      ) : null}
                      <ChevronRight
                        className="motion-arrow size-4 text-muted-foreground group-hover:text-foreground"
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

      <LoadMoreControl
        announcement={paging.announcement}
        disabled={busyTaskId !== null || paging.isRefreshing}
        errorMessage={
          paging.failedMode === "append"
            ? "More Help Wanted tasks could not be loaded. The loaded tasks are still shown."
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

export function HelpWantedList({
  viewerRole,
  initialPage,
  active = true,
  onLoadedStateChange,
}: {
  viewerRole: "Admin" | "Co-Admin" | "Member";
  initialPage?: OffsetListPage<HelpWantedTask>;
  active?: boolean;
  onLoadedStateChange?: (state: {
    count: number;
    hasNextPage: boolean;
  }) => void;
}) {
  return (
    <HelpWantedContents
      viewerRole={viewerRole}
      initialPage={initialPage}
      active={active}
      onLoadedStateChange={onLoadedStateChange}
    />
  );
}

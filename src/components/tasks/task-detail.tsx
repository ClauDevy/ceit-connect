"use client";

import { useMemo, useState } from "react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import {
  Archive,
  ArrowLeft,
  LockKeyhole,
  RefreshCw,
  Users,
} from "lucide-react";
import Link from "next/link";
import { TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";
import {
  YourWorkCard,
  type NewWorkLink,
} from "@/components/tasks/your-work-card";
import { EmptyState } from "@/components/shared/empty-state";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { BoardAssignee, BoardPriority } from "@/lib/events/board";
import {
  getTaskBackHref,
  isTaskDetail,
  type TaskDetail as TaskDetailData,
} from "@/lib/tasks/detail";
import {
  getWorkLinkErrorMessage,
  isTaskWorkLinks,
  type TaskWorkLinks,
} from "@/lib/tasks/work-links";
import { createClient } from "@/lib/supabase/client";
import { APP_TIME_ZONE } from "@/lib/timezone";

type TaskDetailProps = {
  taskId: string;
  initialTask?: TaskDetailData | null;
  initialWorkLinks?: TaskWorkLinks | null;
  canFetch?: boolean;
};

const POLL_INTERVAL_MS = 15_000;

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: APP_TIME_ZONE.iana,
});

function priorityVariant(priority: BoardPriority) {
  if (priority === "Critical") return "destructive" as const;
  if (priority === "High") return "outline" as const;
  return "neutral" as const;
}

function AssigneeList({
  label,
  assignees,
}: {
  label: string;
  assignees: BoardAssignee[];
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-muted-foreground">
        {label}
      </p>
      {assignees.length > 0 ? (
        <div className="space-y-2.5">
          {assignees.map((assignee) => {
            const name = assignee.full_name ?? "Former member";
            return (
              <div key={assignee.id} className="flex items-center gap-2.5">
                <UserAvatar
                  name={name}
                  src={assignee.avatar_url}
                  size="sm"
                  className={
                    assignee.full_name
                      ? undefined
                      : "bg-muted text-muted-foreground"
                  }
                />
                <span className="min-w-0 truncate text-sm font-medium">
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">None</p>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-semibold">{value}</span>
    </div>
  );
}

function BackLink({ task }: { task: TaskDetailData | null }) {
  const label =
    task && !task.is_masked && task.event_name
      ? `Back to ${task.event_name}`
      : "Home";

  return (
    <Link
      href={getTaskBackHref(task)}
      className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <ArrowLeft className="size-4" aria-hidden /> {label}
    </Link>
  );
}

function MaskedTask({ task }: { task: TaskDetailData }) {
  return (
    <div className="space-y-5">
      <BackLink task={task} />
      <Card>
        <CardContent className="py-10 text-center sm:py-14">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <LockKeyhole className="size-6" aria-hidden />
          </div>
          <div className="mb-3 flex flex-wrap justify-center gap-2">
            <Badge variant="outline">{task.status}</Badge>
            <Badge variant="neutral">{task.phase?.trim() || "Unphased"}</Badge>
          </div>
          <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
            Confidential Task
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            This task is visible on the board, but its details are restricted.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

type WorkLinksSectionProps = {
  data: TaskWorkLinks | null | undefined;
  isPending: boolean;
  hasRefreshError: boolean;
  onRetry: () => void;
  onAddLink: (link: NewWorkLink) => Promise<void>;
  onRemoveLink: (linkId: string) => Promise<void>;
};

function WorkLinksSection({
  data,
  isPending,
  hasRefreshError,
  onRetry,
  onAddLink,
  onRemoveLink,
}: WorkLinksSectionProps) {
  if (isPending) {
    return (
      <Card aria-label="Loading work links">
        <CardContent className="space-y-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-72 max-w-full" />
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (data === null) return null;

  if (data === undefined) {
    return (
      <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
        <span>Work links could not be loaded.</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden /> Retry
        </Button>
      </InlineAlert>
    );
  }

  return (
    <div className="space-y-3">
      {hasRefreshError ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Work links could not refresh. The last successful result is still
            shown.
          </span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw aria-hidden /> Retry
          </Button>
        </InlineAlert>
      ) : null}
      <YourWorkCard
        links={data.links}
        isAssignee={data.can_add}
        onAddLink={data.can_add ? onAddLink : undefined}
        onRemoveLink={onRemoveLink}
      />
    </div>
  );
}

function RealTask({
  task,
  workLinks,
}: {
  task: TaskDetailData;
  workLinks: WorkLinksSectionProps;
}) {
  const dependencyName = task.dependency_label ?? "a task you can’t view";
  const taskTypeLabel =
    task.task_type === "LiveOperation" ? "Live Operation" : "Deliverable";

  return (
    <div className="space-y-5">
      <BackLink task={task} />

      {task.event_status === "Archived" ? (
        <InlineAlert variant="info" className="flex items-start gap-2.5">
          <Archive className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            This task belongs to an archived event and is permanently read only.
          </span>
        </InlineAlert>
      ) : null}

      {task.is_blocked ? (
        <InlineAlert variant="info" className="flex items-start gap-2.5">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>Blocked —</strong> this task can’t start until{" "}
            <strong>{dependencyName}</strong> is marked Completed.
          </span>
        </InlineAlert>
      ) : null}

      {task.is_confidential ? (
        <InlineAlert variant="info" className="flex items-start gap-2.5">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            <strong>Confidential —</strong> Admins and the owning Co-Admin
            always have access. Assignees and the additional viewers shown below
            may also view this task.
          </span>
        </InlineAlert>
      ) : null}

      <header>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{task.status}</Badge>
          {task.effective_priority ? (
            <Badge variant={priorityVariant(task.effective_priority)}>
              {task.effective_priority} priority
            </Badge>
          ) : null}
          <Badge variant="neutral">{taskTypeLabel}</Badge>
        </div>
        <h1 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          {task.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {task.event_name} · {task.committee_name}
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Description</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {task.description?.trim() || "No description provided."}
              </p>
            </CardContent>
          </Card>
          <WorkLinksSection {...workLinks} />
        </div>

        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                <Users className="size-4" aria-hidden /> Assignees
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5 pt-4">
              <AssigneeList
                label="Primary"
                assignees={task.primary_assignees}
              />
              <AssigneeList label="Assist" assignees={task.assist_assignees} />
            </CardContent>
          </Card>

          {task.is_confidential ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                  <LockKeyhole className="size-4" aria-hidden /> Additional
                  viewers
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                {task.access_list.length > 0 ? (
                  <div className="space-y-2.5">
                    {task.access_list.map((viewer) => {
                      const name = viewer.full_name ?? "Member";
                      return (
                        <div
                          key={viewer.id}
                          className="flex items-center gap-2.5"
                        >
                          <UserAvatar
                            name={name}
                            src={viewer.avatar_url}
                            size="sm"
                          />
                          <span className="min-w-0 truncate text-sm font-medium">
                            {name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No additional viewers.
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="space-y-3">
              {task.task_type === "LiveOperation" ? (
                <>
                  <DetailRow
                    label="Call time"
                    value={
                      task.call_time
                        ? dateTimeFormatter.format(new Date(task.call_time))
                        : "Not set"
                    }
                  />
                  <DetailRow
                    label="End time"
                    value={
                      task.end_time
                        ? dateTimeFormatter.format(new Date(task.end_time))
                        : "Not set"
                    }
                  />
                </>
              ) : (
                <DetailRow
                  label="Deadline"
                  value={
                    task.due_date
                      ? dateTimeFormatter.format(new Date(task.due_date))
                      : "Not set"
                  }
                />
              )}
              <DetailRow
                label="Created"
                value={dateFormatter.format(new Date(task.created_at!))}
              />
              <DetailRow label="Associated event" value={task.event_name!} />
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function TaskDetailContents({
  taskId,
  initialTask,
  initialWorkLinks,
  canFetch = true,
}: TaskDetailProps) {
  const supabase = useMemo(() => createClient(), []);
  const query = useQuery({
    queryKey: ["task-detail", taskId],
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("get_task_detail", { p_task_id: taskId });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || data.length > 1) {
        throw new Error("The task detail returned an invalid response.");
      }
      if (data.length === 0) return null;
      if (!isTaskDetail(data[0])) {
        throw new Error("The task detail returned an invalid response.");
      }
      return data[0];
    },
    enabled: canFetch,
    initialData: initialTask,
    refetchOnWindowFocus: true,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const workLinksQuery = useQuery({
    queryKey: ["task-work-links", taskId],
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("get_task_work_links", {
        p_task_id: taskId,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || data.length > 1) {
        throw new Error("The work-link reader returned an invalid response.");
      }
      if (data.length === 0) return null;
      if (!isTaskWorkLinks(data[0])) {
        throw new Error("The work-link reader returned an invalid response.");
      }
      return data[0];
    },
    enabled:
      canFetch &&
      query.data !== undefined &&
      query.data !== null &&
      !query.data.is_masked,
    initialData: initialWorkLinks,
    refetchOnWindowFocus: true,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  async function refreshAccess() {
    await Promise.all([query.refetch(), workLinksQuery.refetch()]);
  }

  async function addWorkLink(link: NewWorkLink) {
    const { data, error } = await supabase.rpc("add_task_work_link", {
      p_task_id: taskId,
      p_name: link.name ?? "",
      p_url: link.url,
    });

    if (error) {
      await refreshAccess();
      throw new Error(getWorkLinkErrorMessage(error, "add"));
    }
    if (!Array.isArray(data) || data.length !== 1) {
      await workLinksQuery.refetch();
      throw new Error("The link could not be added. Please try again.");
    }

    await workLinksQuery.refetch();
  }

  async function removeWorkLink(linkId: string) {
    const { error } = await supabase.rpc("remove_task_work_link", {
      p_link_id: linkId,
    });

    if (error) {
      await refreshAccess();
      throw new Error(getWorkLinkErrorMessage(error, "remove"));
    }

    await workLinksQuery.refetch();
  }

  if (query.isPending) return <TaskDetailSkeleton />;

  if (query.error && query.data === undefined) {
    return (
      <div className="space-y-5">
        <BackLink task={null} />
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>Task details could not be loaded.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </InlineAlert>
      </div>
    );
  }

  if (query.data === null) {
    return (
      <div className="space-y-5">
        <BackLink task={null} />
        <Card>
          <EmptyState
            title="This task is no longer available"
            description="It may have been removed, returned to Draft, or your access may have changed."
            action={
              <Link
                href="/home"
                className={buttonVariants({ variant: "outline" })}
              >
                Go Home
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <>
      {query.error ? (
        <InlineAlert className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <span>
            Task details could not refresh. The last successful result is still
            shown.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </InlineAlert>
      ) : null}
      {query.data.is_masked ? (
        <MaskedTask task={query.data} />
      ) : (
        <RealTask
          task={query.data}
          workLinks={{
            data: workLinksQuery.data,
            isPending: workLinksQuery.isPending,
            hasRefreshError: Boolean(workLinksQuery.error),
            onRetry: () => void workLinksQuery.refetch(),
            onAddLink: addWorkLink,
            onRemoveLink: removeWorkLink,
          }}
        />
      )}
    </>
  );
}

export function TaskDetail(props: TaskDetailProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <TaskDetailContents {...props} />
    </QueryClientProvider>
  );
}

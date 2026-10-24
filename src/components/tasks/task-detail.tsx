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
  CalendarClock,
  LockKeyhole,
  RefreshCw,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";
import { TaskComments } from "@/components/tasks/task-comments";
import { ArchivedTaskSharing } from "@/components/tasks/archived-task-sharing";
import { TaskEditControls } from "@/components/tasks/task-edit-controls";
import {
  TaskBackupRequestedCard,
  TaskBackupToggle,
  type BackupBusyAction,
} from "@/components/tasks/task-backup-controls";
import { TaskPeopleControls } from "@/components/tasks/task-people-controls";
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
  getTaskEditErrorMessage,
  isTaskEditControlData,
  isTaskDeleteResult,
  isTaskPeopleMutationResult,
  type TaskEditControlData,
} from "@/lib/tasks/edit-controls";
import {
  getWorkLinkErrorMessage,
  isTaskWorkLinks,
  type TaskWorkLinks,
} from "@/lib/tasks/work-links";
import {
  getAcceptVolunteerOutcomeMessage,
  getTaskBackupErrorMessage,
  isAcceptVolunteerResult,
  isBackupToggleResult,
  isTaskBackupState,
  isVolunteerTaskResult,
  isWithdrawVolunteerResult,
  type TaskBackupState,
} from "@/lib/tasks/backup";
import {
  isTaskAssigneeWorkload,
  workloadCountsByUserId,
  type TaskAssigneeWorkload,
} from "@/lib/tasks/workload";
import { createClient } from "@/lib/supabase/client";
import { APP_TIME_ZONE } from "@/lib/timezone";

type TaskDetailProps = {
  taskId: string;
  initialTask?: TaskDetailData | null;
  initialWorkLinks?: TaskWorkLinks | null;
  initialEditControls?: TaskEditControlData | null;
  initialBackupState?: TaskBackupState | null;
  initialWorkloads?: TaskAssigneeWorkload[];
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
      className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
    >
      <ArrowLeft className="size-4" aria-hidden /> {label}
    </Link>
  );
}

function MaskedTask({ task }: { task: TaskDetailData }) {
  return (
    <div className="space-y-5">
      <BackLink task={task} />
      <Card className="border-dashed bg-gradient-to-br from-card via-card to-muted/60">
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
        <CardContent className="space-y-3 px-4 py-4 sm:px-5 sm:py-5">
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
  editControls,
  backup,
  onRefreshTask,
}: {
  task: TaskDetailData;
  onRefreshTask: () => Promise<void>;
  workLinks: WorkLinksSectionProps;
  editControls: {
    data: TaskEditControlData | null | undefined;
    onSaveDependency: (dependencyId: string | null) => Promise<void>;
    onSaveConfidentiality: (
      isConfidential: boolean,
      viewerIds: string[],
    ) => Promise<void>;
    onAssignPeople: (
      primaryAssigneeIds: string[],
      assistAssigneeIds: string[],
    ) => Promise<void>;
    onDeleteTask: () => Promise<void>;
    onUnassignSelf: () => Promise<void>;
    workloadCounts: ReadonlyMap<string, number>;
  };
  backup: {
    data: TaskBackupState | null | undefined;
    busyAction: BackupBusyAction;
    error: string | null;
    notice: string | null;
    onToggle: (nextState: boolean) => Promise<void>;
    onVolunteer: () => Promise<void>;
    onWithdraw: () => Promise<void>;
    onAccept: (userId: string) => Promise<void>;
  };
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

      <header className="space-y-3">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="outline">{task.status}</Badge>
              {task.effective_priority ? (
                <Badge variant={priorityVariant(task.effective_priority)}>
                  {task.effective_priority} priority
                </Badge>
              ) : null}
              <Badge variant="neutral">{taskTypeLabel}</Badge>
            </div>
            <h1 className="max-w-3xl font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {task.title}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {task.event_name} · {task.committee_name}
            </p>
          </div>
          {backup.data?.out_can_toggle_backup ? (
            <div className="sm:shrink-0">
              <TaskBackupToggle
                state={backup.data}
                busyAction={backup.busyAction}
                onToggle={backup.onToggle}
              />
            </div>
          ) : null}
        </div>
        <div className="empty:hidden" aria-live="polite" aria-atomic="true">
          {backup.error ? <InlineAlert>{backup.error}</InlineAlert> : null}
          {backup.notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {backup.notice}
            </p>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
              <CardTitle className="text-[15px]">Description</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                {task.description?.trim() || "No description provided."}
              </p>
            </CardContent>
          </Card>
          <WorkLinksSection {...workLinks} />
          <TaskComments
            taskId={task.id}
            isArchived={task.event_status === "Archived"}
            onRefreshTask={onRefreshTask}
          />
        </div>

        <aside className="space-y-4">
          {backup.data ? (
            <TaskBackupRequestedCard
              state={backup.data}
              busyAction={backup.busyAction}
              onVolunteer={backup.onVolunteer}
              onWithdraw={backup.onWithdraw}
              onAccept={backup.onAccept}
            />
          ) : null}

          <Card>
            <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
              <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                <Users className="size-4" aria-hidden /> Assignees
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
              <AssigneeList
                label="Primary"
                assignees={task.primary_assignees}
              />
              <AssigneeList label="Assist" assignees={task.assist_assignees} />
            </CardContent>
          </Card>

          {editControls.data ? (
            <>
              <TaskEditControls
                controls={editControls.data}
                onSaveDependency={editControls.onSaveDependency}
                onSaveConfidentiality={editControls.onSaveConfidentiality}
              />
              <TaskPeopleControls
                controls={editControls.data}
                taskTitle={task.title}
                onAssignPeople={editControls.onAssignPeople}
                onDeleteTask={editControls.onDeleteTask}
                onUnassignSelf={editControls.onUnassignSelf}
                workloadCounts={editControls.workloadCounts}
              />
            </>
          ) : null}

          {task.is_confidential && task.event_status === "Archived" ? (
            <ArchivedTaskSharing taskId={task.id} viewers={task.access_list} />
          ) : task.is_confidential &&
            !editControls.data?.can_set_confidentiality ? (
            <Card>
              <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
                <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                  <LockKeyhole className="size-4" aria-hidden /> Additional
                  viewers
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
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
            <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
              <CardTitle className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                <CalendarClock className="size-4" aria-hidden /> Schedule
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
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
  initialEditControls,
  initialBackupState,
  initialWorkloads,
  canFetch = true,
}: TaskDetailProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [backupBusyAction, setBackupBusyAction] =
    useState<BackupBusyAction>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
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

  const editControlsQuery = useQuery({
    queryKey: ["task-edit-controls", taskId],
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("get_task_edit_controls", {
        p_task_id: taskId,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || data.length > 1) {
        throw new Error("The task edit controls returned an invalid response.");
      }
      if (data.length === 0) return null;
      if (!isTaskEditControlData(data[0])) {
        throw new Error("The task edit controls returned an invalid response.");
      }
      return data[0];
    },
    enabled: canFetch,
    initialData: initialEditControls,
    refetchOnWindowFocus: true,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const backupStateQuery = useQuery({
    queryKey: ["task-backup-state", taskId],
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("get_task_backup_state", {
        p_task_id: taskId,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || data.length > 1) {
        throw new Error("The task backup state returned an invalid response.");
      }
      if (data.length === 0) return null;
      if (!isTaskBackupState(data[0])) {
        throw new Error("The task backup state returned an invalid response.");
      }
      return data[0];
    },
    enabled:
      canFetch &&
      query.data !== undefined &&
      query.data !== null &&
      !query.data.is_masked,
    initialData: initialBackupState,
    refetchOnWindowFocus: true,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const workloadQuery = useQuery({
    queryKey: ["task-assignee-workload"],
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("list_active_task_assignees_with_workload");
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isTaskAssigneeWorkload)) {
        throw new Error(
          "The task workload reader returned an invalid response.",
        );
      }
      return data;
    },
    enabled: canFetch && editControlsQuery.data?.can_assign_people === true,
    initialData: initialWorkloads,
    refetchOnWindowFocus: true,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });

  const workloadCounts = useMemo(
    () => workloadCountsByUserId(workloadQuery.data ?? []),
    [workloadQuery.data],
  );

  async function refreshAccess() {
    await Promise.all([
      query.refetch(),
      workLinksQuery.refetch(),
      editControlsQuery.refetch(),
      backupStateQuery.refetch(),
      editControlsQuery.data?.can_assign_people
        ? workloadQuery.refetch()
        : Promise.resolve(),
    ]);
  }

  async function setBackupRequest(nextState: boolean) {
    if (backupBusyAction) return;
    setBackupBusyAction("toggle-backup");
    setBackupError(null);
    setBackupNotice(null);
    try {
      const { data, error } = await supabase.rpc("set_task_backup_request", {
        p_task_id: taskId,
        p_request_backup: nextState,
      });
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isBackupToggleResult(data[0])
      ) {
        throw new Error("The backup writer returned an invalid response.");
      }
      setBackupNotice(
        nextState ? "Backup requested." : "Backup request cancelled.",
      );
    } catch (error) {
      const refreshed = await backupStateQuery.refetch();
      const code =
        error && typeof error === "object"
          ? (error as { code?: string }).code
          : undefined;
      const noOpReachedCurrentState =
        code === "CCB05" && refreshed.data?.out_request_backup === nextState;
      if (!noOpReachedCurrentState) {
        setBackupError(getTaskBackupErrorMessage("toggle-backup", error));
      }
    } finally {
      try {
        await refreshAccess();
      } finally {
        setBackupBusyAction(null);
      }
    }
  }

  async function volunteerForTask() {
    if (backupBusyAction) return;
    setBackupBusyAction("volunteer");
    setBackupError(null);
    setBackupNotice(null);
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
      setBackupNotice("You volunteered to help.");
    } catch (error) {
      setBackupError(getTaskBackupErrorMessage("volunteer", error));
    } finally {
      try {
        await refreshAccess();
      } finally {
        setBackupBusyAction(null);
      }
    }
  }

  async function withdrawVolunteer() {
    if (backupBusyAction) return;
    setBackupBusyAction("withdraw");
    setBackupError(null);
    setBackupNotice(null);
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
      setBackupNotice("Your volunteer offer was withdrawn.");
    } catch (error) {
      setBackupError(getTaskBackupErrorMessage("withdraw", error));
    } finally {
      try {
        await refreshAccess();
      } finally {
        setBackupBusyAction(null);
      }
    }
  }

  async function acceptVolunteer(userId: string) {
    if (backupBusyAction) return;
    setBackupBusyAction(`accept:${userId}`);
    setBackupError(null);
    setBackupNotice(null);
    try {
      const { data, error } = await supabase.rpc("accept_task_volunteer", {
        p_task_id: taskId,
        p_user_id: userId,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : null;
      if (!result || data.length !== 1 || !isAcceptVolunteerResult(result)) {
        throw new Error("The acceptance writer returned an invalid response.");
      }
      setBackupNotice(getAcceptVolunteerOutcomeMessage(result.out_outcome));
    } catch (error) {
      setBackupError(getTaskBackupErrorMessage("accept", error));
    } finally {
      try {
        await refreshAccess();
      } finally {
        setBackupBusyAction(null);
      }
    }
  }

  async function saveDependency(dependencyId: string | null) {
    try {
      const { data, error } = await supabase.rpc("set_task_dependency", {
        p_task_id: taskId,
        p_depends_on_task_id: dependencyId,
      });
      if (error) throw error;
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error("The dependency writer returned an invalid response.");
      }
    } catch (error) {
      await refreshAccess();
      throw new Error(getTaskEditErrorMessage(error, "dependency"));
    }

    await refreshAccess();
  }

  async function saveConfidentiality(
    isConfidential: boolean,
    viewerIds: string[],
  ) {
    try {
      const { data, error } = await supabase.rpc("set_task_confidentiality", {
        p_task_id: taskId,
        p_is_confidential: isConfidential,
        p_allowed_viewers: viewerIds,
      });
      if (error) throw error;
      if (!Array.isArray(data) || data.length !== 1) {
        throw new Error(
          "The confidentiality writer returned an invalid response.",
        );
      }
    } catch (error) {
      await refreshAccess();
      throw new Error(getTaskEditErrorMessage(error, "confidentiality"));
    }

    await refreshAccess();
  }

  async function assignPeople(
    primaryAssigneeIds: string[],
    assistAssigneeIds: string[],
  ) {
    try {
      const { data, error } = await supabase.rpc("assign_task_people", {
        p_task_id: taskId,
        p_primary_assignees: primaryAssigneeIds,
        p_assist_assignees: assistAssigneeIds,
      });
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isTaskPeopleMutationResult(data[0])
      ) {
        throw new Error("The assignment writer returned an invalid response.");
      }
    } catch (error) {
      await refreshAccess();
      throw new Error(getTaskEditErrorMessage(error, "assignment"));
    }

    await refreshAccess();
  }

  async function deleteTask() {
    const backHref = getTaskBackHref(query.data ?? null);
    try {
      const { data, error } = await supabase.rpc("delete_task", {
        p_task_id: taskId,
      });
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isTaskDeleteResult(data[0])
      ) {
        throw new Error("The delete writer returned an invalid response.");
      }
    } catch (error) {
      await refreshAccess();
      throw new Error(getTaskEditErrorMessage(error, "delete"));
    }

    router.replace(backHref);
  }

  async function unassignSelf() {
    const backHref = getTaskBackHref(query.data ?? null);
    const willLoseAccess =
      editControlsQuery.data?.self_unassign_will_lose_access === true;
    try {
      const { data, error } = await supabase.rpc("unassign_self", {
        p_task_id: taskId,
      });
      if (error) throw error;
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        !isTaskPeopleMutationResult(data[0])
      ) {
        throw new Error(
          "The self-unassign writer returned an invalid response.",
        );
      }
    } catch (error) {
      await refreshAccess();
      throw new Error(getTaskEditErrorMessage(error, "unassign"));
    }

    await refreshAccess();
    if (willLoseAccess) router.replace(backHref);
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
      <div className="space-y-5 [&_button]:transition-colors [&_button]:duration-150 motion-reduce:[&_button]:transition-none">
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
      <div className="space-y-5 [&_button]:transition-colors [&_button]:duration-150 motion-reduce:[&_button]:transition-none">
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
    <div className="[&_button]:transition-colors [&_button]:duration-150 motion-reduce:[&_button]:transition-none">
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
          onRefreshTask={async () => {
            await query.refetch();
          }}
          workLinks={{
            data: workLinksQuery.data,
            isPending: workLinksQuery.isPending,
            hasRefreshError: Boolean(workLinksQuery.error),
            onRetry: () => void workLinksQuery.refetch(),
            onAddLink: addWorkLink,
            onRemoveLink: removeWorkLink,
          }}
          editControls={{
            data: editControlsQuery.data,
            onSaveDependency: saveDependency,
            onSaveConfidentiality: saveConfidentiality,
            onAssignPeople: assignPeople,
            onDeleteTask: deleteTask,
            onUnassignSelf: unassignSelf,
            workloadCounts,
          }}
          backup={{
            data: backupStateQuery.data,
            busyAction: backupBusyAction,
            error: backupError,
            notice: backupNotice,
            onToggle: setBackupRequest,
            onVolunteer: volunteerForTask,
            onWithdraw: withdrawVolunteer,
            onAccept: acceptVolunteer,
          }}
        />
      )}
    </div>
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

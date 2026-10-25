import Link from "next/link";
import { ArrowLeft, CalendarDays, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import { EventBanner } from "@/components/events/event-banner";
import { PageHeader } from "@/components/shared/page-header";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { StretchedLink } from "@/components/shared/stretched-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { getActiveProfileForRoles } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { APP_TIME_ZONE } from "@/lib/timezone";

type ArchivedEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  banner_url: string | null;
};

type ArchivedTask = {
  id: string;
  phase: string | null;
  status: "To Do" | "In Progress" | "Completed";
  priority: "Low" | "Medium" | "High" | "Critical";
  task_type: "Deliverable" | "LiveOperation";
  due_date: string | null;
  primary_assignees: string[];
  assist_assignees: string[];
};

type TaskContent = {
  id: string;
  title: string;
  description: string | null;
};

type ArchivedAssignee = {
  id: string;
  full_name: string;
  avatar_url: string | null;
};

function isArchivedAssignee(value: unknown): value is ArchivedAssignee {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.full_name === "string" &&
    (typeof row.avatar_url === "string" || row.avatar_url === null)
  );
}

const eventDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const taskDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

function formatEventDate(date: string) {
  return eventDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function formatEventDateRange(event: ArchivedEvent) {
  if (!event.end_date || event.end_date === event.start_date) {
    return formatEventDate(event.start_date);
  }

  return `${formatEventDate(event.start_date)} – ${formatEventDate(event.end_date)}`;
}

export default async function ArchivedEventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const profile = await getActiveProfileForRoles([
    "Admin",
    "Co-Admin",
    "Member",
  ]);
  if (!profile) redirect("/home");

  const { eventId } = await params;
  const supabase = await createClient();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, name, description, start_date, end_date, banner_url")
    .eq("id", eventId)
    .eq("status", "Archived")
    .maybeSingle<ArchivedEvent>();

  if (eventError) {
    console.error("Failed to load Archived event:", eventError);
  }

  if (!event && !eventError) redirect("/archives");

  if (eventError || !event) {
    return (
      <InlineAlert>
        This archived event could not be loaded. Return to Event Archives and
        try again.
      </InlineAlert>
    );
  }

  const [tasksResult, assigneesResult] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id, phase, status, priority, task_type, due_date, primary_assignees, assist_assignees",
      )
      .eq("event_id", event.id)
      .order("created_at", { ascending: true })
      .returns<ArchivedTask[]>(),
    supabase.rpc("list_archived_event_assignees", { p_event_id: event.id }),
  ]);

  const { data: tasks, error: tasksError } = tasksResult;
  const assigneeRows: unknown = assigneesResult.data;
  const assigneeDataInvalid =
    !assigneesResult.error &&
    (!Array.isArray(assigneeRows) || !assigneeRows.every(isArchivedAssignee));
  const assignees: ArchivedAssignee[] =
    Array.isArray(assigneeRows) && assigneeRows.every(isArchivedAssignee)
      ? assigneeRows
      : [];
  const assigneesUnavailable =
    Boolean(assigneesResult.error) || assigneeDataInvalid;

  if (tasksError) {
    console.error("Failed to load Archived event tasks:", tasksError);
  }
  if (assigneesResult.error) {
    console.error(
      "Failed to load Archived event assignees:",
      assigneesResult.error,
    );
  } else if (assigneeDataInvalid) {
    console.error("Archived event assignees returned invalid data.");
  }

  const taskContentResults = await Promise.all(
    (tasks ?? []).map((task) =>
      supabase.rpc("get_task", { p_task_id: task.id }).single<TaskContent>(),
    ),
  );
  const taskContentError = taskContentResults.find(
    (result) => result.error,
  )?.error;
  if (taskContentError) {
    console.error("Failed to load Archived task content:", taskContentError);
  }

  const taskContent = new Map(
    taskContentResults.flatMap((result) =>
      result.data ? [[result.data.id, result.data] as const] : [],
    ),
  );
  const assigneesById = new Map(
    (assignees ?? []).map((assignee) => [assignee.id, assignee] as const),
  );

  return (
    <>
      <Link
        href="/archives"
        className={buttonVariants({
          variant: "ghost",
          size: "sm",
          className: "mb-4",
        })}
      >
        <ArrowLeft aria-hidden />
        Event Archives
      </Link>

      <PageHeader
        title={event.name}
        description="Archived event record"
        actions={<Badge variant="neutral">Archived</Badge>}
      />

      <Card className="mb-6 bg-muted/40">
        <CardContent className="flex items-start gap-3">
          <LockKeyhole
            className="mt-0.5 size-5 shrink-0 text-muted-foreground"
            aria-hidden
          />
          <div>
            <p className="text-sm font-semibold">Read-only record</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This event and its tasks are permanently frozen as they stood when
              archived.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-8 max-w-3xl overflow-hidden">
        <EventBanner
          src={event.banner_url}
          alt={`${event.name} banner`}
          className="aspect-video w-full"
        />
        <CardContent className="space-y-3">
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{formatEventDateRange(event)}</span>
          </p>
          {event.description ? (
            <p className="whitespace-pre-line text-sm leading-relaxed">
              {event.description}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              No event description.
            </p>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="archived-tasks-heading">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2
            id="archived-tasks-heading"
            className="font-display text-lg font-semibold sm:text-xl"
          >
            Tasks
          </h2>
          <span className="text-sm text-muted-foreground">
            {tasks?.length ?? 0}
          </span>
        </div>

        {tasksError || taskContentError || assigneesUnavailable ? (
          <InlineAlert className="mb-4">
            Some archived task information could not be loaded. Refresh to try
            again.
          </InlineAlert>
        ) : null}

        {tasks?.length ? (
          <div className="grid gap-4">
            {tasks.map((task) => {
              const content = taskContent.get(task.id);
              const assigneeIds = Array.from(
                new Set([...task.primary_assignees, ...task.assist_assignees]),
              );
              return (
                <Card key={task.id} className="group relative">
                  <StretchedLink
                    href={`/tasks/${task.id}`}
                    label={`Open ${content?.title ?? "Task details unavailable"}`}
                  />
                    <CardHeader className="sm:flex sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                      <div className="min-w-0">
                        <CardTitle>
                          {content?.title ?? "Task details unavailable"}
                        </CardTitle>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {task.phase || "No phase"} ·{" "}
                          {task.task_type === "LiveOperation"
                            ? "Live Operation"
                            : "Deliverable"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">{task.status}</Badge>
                        <PriorityBadge priority={task.priority} />
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3 pt-4">
                      {content?.description ? (
                        <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                          {content.description}
                        </p>
                      ) : null}
                      {task.due_date ? (
                        <p className="text-xs text-muted-foreground">
                          Due {taskDateFormatter.format(new Date(task.due_date))}
                        </p>
                      ) : null}
                      {assigneeIds.length > 0 ? (
                        <div>
                          <p className="mb-2 text-xs font-semibold text-muted-foreground">
                            Assignees
                          </p>
                          {assigneesUnavailable ? (
                            <p className="text-xs text-muted-foreground">
                              Assignee names are unavailable.
                            </p>
                          ) : (
                            <div className="flex flex-wrap gap-3">
                              {assigneeIds.map((assigneeId) => {
                                const assignee = assigneesById.get(assigneeId);
                                const name =
                                  assignee?.full_name ?? "Former member";

                                return (
                                  <span
                                    key={assigneeId}
                                    className="flex items-center gap-2 text-sm"
                                  >
                                    <UserAvatar
                                      name={name}
                                      src={assignee?.avatar_url}
                                      size="sm"
                                      className={
                                        assignee
                                          ? undefined
                                          : "bg-muted text-muted-foreground"
                                      }
                                    />
                                    <span>{name}</span>
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </CardContent>
                </Card>
              );
            })}
          </div>
        ) : !tasksError ? (
          <Card>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                No tasks are visible to you in this archive.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </>
  );
}

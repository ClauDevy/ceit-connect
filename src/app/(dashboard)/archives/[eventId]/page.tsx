import Link from "next/link";
import { ArrowLeft, CalendarDays, LockKeyhole } from "lucide-react";
import { redirect } from "next/navigation";
import {
  ArchivedTaskList,
  type ArchivedAssignee,
  type ArchivedTask,
  type ArchivedTaskContent,
} from "@/components/archives/archived-task-list";
import { EventBanner } from "@/components/events/event-banner";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { getActiveProfileForRoles } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type ArchivedEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  banner_url: string | null;
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
      supabase
        .rpc("get_task", { p_task_id: task.id })
        .single<ArchivedTaskContent>(),
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
    assignees.map((assignee) => [assignee.id, assignee] as const),
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

      <div className="mb-4 flex items-start gap-2.5 rounded-xl border bg-muted/40 px-3.5 py-2.5">
        <LockKeyhole
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">
          <span className="font-semibold text-foreground">
            Read-only record.
          </span>{" "}
          This event and its tasks are permanently frozen as they stood when
          archived.
        </p>
      </div>

      <Card className="mb-8 grid max-w-5xl overflow-hidden md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <EventBanner
          src={event.banner_url}
          alt={`${event.name} banner`}
          className="aspect-video w-full self-center"
        />
        <CardContent className="flex min-w-0 flex-col justify-center gap-3 p-4 sm:p-5 md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h1 className="min-w-0 font-display text-2xl font-semibold leading-tight tracking-tight sm:text-3xl">
              {event.name}
            </h1>
            <Badge variant="neutral">Archived</Badge>
          </div>
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

      <section aria-labelledby="archived-tasks-heading" className="max-w-5xl">
        <div className="mb-4 flex items-baseline gap-2 border-b pb-2.5">
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
          <ArchivedTaskList
            tasks={tasks}
            taskContent={taskContent}
            assignees={assigneesById}
            assigneesUnavailable={assigneesUnavailable}
          />
        ) : !tasksError ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center">
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

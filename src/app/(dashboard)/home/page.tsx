import Link from "next/link";
import { CalendarDays, FileText, Pencil, Plus } from "lucide-react";
import { ArchiveEventButton } from "@/components/events/archive-event-button";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { TigerLogo } from "@/components/ui/tiger-logo";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type HomeEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  status: "Active" | "Draft";
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(date: string) {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function formatDateRange(event: HomeEvent) {
  if (!event.end_date) {
    return `Starts ${formatDate(event.start_date)}`;
  }

  if (event.start_date === event.end_date) {
    return formatDate(event.start_date);
  }

  return `${formatDate(event.start_date)} – ${formatDate(event.end_date)}`;
}

function ActiveEventCard({
  event,
  canEdit,
  canArchive,
  incompleteTaskCount,
}: {
  event: HomeEvent;
  canEdit: boolean;
  canArchive: boolean;
  incompleteTaskCount: number;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="relative flex h-20 items-center justify-end overflow-hidden bg-gradient-to-br from-primary/15 via-muted to-accent/30 px-6 sm:h-24">
        <TigerLogo size={72} className="opacity-20" />
      </div>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-display text-lg font-semibold leading-snug">
            {event.name}
          </h3>
          <Badge variant="outline">Active</Badge>
        </div>
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{formatDateRange(event)}</span>
        </p>
        {event.description ? (
          <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">
            {event.description}
          </p>
        ) : null}
        <div className="flex flex-wrap items-start gap-2">
          {canEdit && (
            <Link
              href={`/events/${event.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Pencil aria-hidden />
              Edit
            </Link>
          )}
          {canArchive ? (
            <ArchiveEventButton
              eventId={event.id}
              eventName={event.name}
              incompleteTaskCount={incompleteTaskCount}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function DraftEventCard({
  event,
  canEdit,
}: {
  event: HomeEvent;
  canEdit: boolean;
}) {
  return (
    <Card className="border-2 border-dashed bg-card/70">
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
            <FileText className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h3 className="font-display font-semibold leading-snug">
              {event.name}
            </h3>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{formatDateRange(event)}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge variant="neutral">Draft</Badge>
          {canEdit && (
            <Link
              href={`/events/${event.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Pencil aria-hidden />
              Edit
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default async function HomePage() {
  await requireUser();

  const supabase = await createClient();
  const leadershipProfilePromise = getActiveProfileForRoles([
    "Admin",
    "Co-Admin",
  ]);
  const eventsPromise = supabase
    .from("events")
    .select("id, name, description, start_date, end_date, status")
    .in("status", ["Active", "Draft"])
    .order("start_date", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<HomeEvent[]>();

  const [leadershipProfile, { data: events, error }] = await Promise.all([
    leadershipProfilePromise,
    eventsPromise,
  ]);

  if (error) {
    console.error("Failed to load Home events:", error);
  }

  const activeEvents = events?.filter((event) => event.status === "Active") ?? [];
  const draftEvents = events?.filter((event) => event.status === "Draft") ?? [];
  const hasEvents = activeEvents.length > 0 || draftEvents.length > 0;
  const incompleteTaskCounts = new Map<string, number>();
  let incompleteTasksError = null;

  if (leadershipProfile?.role === "Admin" && activeEvents.length > 0) {
    const result = await supabase
      .from("tasks")
      .select("event_id")
      .in(
        "event_id",
        activeEvents.map((event) => event.id),
      )
      .neq("status", "Completed");

    incompleteTasksError = result.error;
    for (const task of result.data ?? []) {
      incompleteTaskCounts.set(
        task.event_id,
        (incompleteTaskCounts.get(task.event_id) ?? 0) + 1,
      );
    }
  }

  if (incompleteTasksError) {
    console.error("Failed to count incomplete event tasks:", incompleteTasksError);
  }

  return (
    <>
      <PageHeader
        title="Home"
        description="Council events visible to you, ordered by their start date."
        actions={
          leadershipProfile ? (
            <Link
              href="/events/new"
              aria-label="Create event"
              title="Create event"
              className={buttonVariants({ size: "icon" })}
            >
              <Plus aria-hidden />
            </Link>
          ) : null
        }
      />

      {error || incompleteTasksError ? (
        <InlineAlert>
          Events could not be loaded. Refresh the page to try again.
        </InlineAlert>
      ) : !hasEvents ? (
        <Card>
          <EmptyState
            title="No events yet"
            description="When an event is launched—or you save your own draft—it will appear here."
          />
        </Card>
      ) : (
        <div className="space-y-9">
          {activeEvents.length > 0 ? (
            <section aria-labelledby="active-events-heading">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2
                  id="active-events-heading"
                  className="font-display text-lg font-semibold sm:text-xl"
                >
                  Active events
                </h2>
                <span className="text-sm text-muted-foreground">
                  {activeEvents.length}
                </span>
              </div>
              <div className="grid gap-5 md:grid-cols-2">
                {activeEvents.map((event) => (
                  <ActiveEventCard
                    key={event.id}
                    event={event}
                    canEdit={Boolean(leadershipProfile)}
                    canArchive={leadershipProfile?.role === "Admin"}
                    incompleteTaskCount={incompleteTaskCounts.get(event.id) ?? 0}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {draftEvents.length > 0 ? (
            <section aria-labelledby="draft-events-heading">
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2
                    id="draft-events-heading"
                    className="font-display text-lg font-semibold sm:text-xl"
                  >
                    Drafts
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Draft — visible to Admins and Co-Admins
                  </p>
                </div>
                <span className="text-sm text-muted-foreground">
                  {draftEvents.length}
                </span>
              </div>
              <div className="grid gap-4">
                {draftEvents.map((event) => (
                  <DraftEventCard
                    key={event.id}
                    event={event}
                    canEdit={Boolean(leadershipProfile)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </>
  );
}

import Link from "next/link";
import { CalendarDays, Pencil, Plus } from "lucide-react";
import { EventCardMenu } from "@/components/events/event-card-menu";
import { EventBanner } from "@/components/events/event-banner";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StretchedLink } from "@/components/shared/stretched-link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type HomeEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  status: "Active" | "Draft";
  banner_url: string | null;
  updated_at: string;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const exactTimestampFormatter = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Manila",
  timeZoneName: "short",
});

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
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

function formatLastEdited(value: string | null | undefined) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const elapsedSeconds = (date.getTime() - Date.now()) / 1000;
  const absoluteSeconds = Math.abs(elapsedSeconds);
  let unit: Intl.RelativeTimeFormatUnit = "second";
  let divisor = 1;

  if (absoluteSeconds >= 60 * 60 * 24 * 365) {
    unit = "year";
    divisor = 60 * 60 * 24 * 365;
  } else if (absoluteSeconds >= 60 * 60 * 24 * 30) {
    unit = "month";
    divisor = 60 * 60 * 24 * 30;
  } else if (absoluteSeconds >= 60 * 60 * 24) {
    unit = "day";
    divisor = 60 * 60 * 24;
  } else if (absoluteSeconds >= 60 * 60) {
    unit = "hour";
    divisor = 60 * 60;
  } else if (absoluteSeconds >= 60) {
    unit = "minute";
    divisor = 60;
  }

  return {
    exact: exactTimestampFormatter.format(date),
    iso: date.toISOString(),
    relative: relativeTimeFormatter.format(
      Math.round(elapsedSeconds / divisor),
      unit,
    ),
  };
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
  incompleteTaskCount: number | undefined;
}) {
  return (
    <Card className="group relative isolate overflow-hidden border-border/70 hover:border-primary/40 hover:shadow-sm focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/30">
      <StretchedLink
        href={`/events/${event.id}`}
        label={`Open ${event.name}`}
      />
      <EventBanner
        src={event.banner_url}
        alt={`${event.name} banner`}
        loading="lazy"
        decoding="async"
        className="aspect-video w-full"
      />
      <EventCardMenu
        eventId={event.id}
        eventName={event.name}
        canEdit={canEdit}
        canArchive={canArchive}
        incompleteTaskCount={incompleteTaskCount}
        eventUpdatedAt={event.updated_at}
      />
      <CardContent className="space-y-4">
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
        <div className="border-t border-border/70 pt-3 text-sm font-semibold text-primary group-hover:text-foreground group-focus-within:text-foreground">
          View board <span aria-hidden>→</span>
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
  const lastEdited = formatLastEdited(event.updated_at);

  return (
    <Card className="relative border-2 border-dashed bg-card/70">
      {canEdit ? (
        <StretchedLink
          href={`/events/${event.id}/edit`}
          label={`Edit ${event.name}`}
        />
      ) : null}
      <CardContent className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-start gap-3.5">
          <EventBanner
            src={event.banner_url}
            alt={`${event.name} banner`}
            compact
            loading="lazy"
            decoding="async"
            className="size-11 shrink-0 rounded-xl"
          />
          <div className="min-w-0">
            <h3 className="font-display font-semibold leading-snug">
              {event.name}
            </h3>
            <p className="mt-1 flex items-start gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{formatDateRange(event)}</span>
            </p>
            <div className="mt-2 grid gap-0.5 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Not launched</p>
              {lastEdited ? (
                <time
                  dateTime={lastEdited.iso}
                  title={`${lastEdited.exact} (Philippine time)`}
                  aria-label={`Last edited ${lastEdited.exact}, Philippine time`}
                >
                  Last edited {lastEdited.relative}
                </time>
              ) : null}
            </div>
          </div>
        </div>
        <div className="relative z-20 flex flex-wrap items-center gap-2 sm:justify-end">
          <Badge variant="neutral" className="shrink-0">
            Draft
          </Badge>
          {canEdit ? (
            <Link
              href={`/events/${event.id}/edit`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Pencil aria-hidden />
              Edit
            </Link>
          ) : null}
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
    .select(
      "id, name, description, start_date, end_date, status, banner_url, updated_at",
    )
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

  const activeEvents =
    events?.filter((event) => event.status === "Active") ?? [];
  const draftEvents = events?.filter((event) => event.status === "Draft") ?? [];
  const hasEvents = activeEvents.length > 0 || draftEvents.length > 0;
  const incompleteTaskCounts = new Map<string, number>();
  let incompleteTasksError = null;

  if (leadershipProfile?.role === "Admin" && activeEvents.length > 0) {
    const countResults = await Promise.all(
      activeEvents.map(async (event) => {
        const { count, error: countError } = await supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("event_id", event.id)
          .neq("status", "Completed");

        return { eventId: event.id, count, error: countError };
      }),
    );

    for (const result of countResults) {
      if (result.error || result.count === null) {
        incompleteTasksError ??=
          result.error ?? new Error("Incomplete task count was not returned.");
        continue;
      }

      incompleteTaskCounts.set(result.eventId, result.count);
    }
  }

  if (incompleteTasksError) {
    console.error(
      "Failed to count incomplete event tasks:",
      incompleteTasksError,
    );
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
              className={buttonVariants()}
            >
              <Plus aria-hidden />
              Create Event
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
              <div className="mb-4 flex items-end justify-between gap-4">
                <div>
                  <h2
                    id="active-events-heading"
                    className="font-display text-lg font-semibold sm:text-xl"
                  >
                    Active events
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Open an event to view its task board.
                  </p>
                </div>
                <Badge variant="neutral" aria-label={`${activeEvents.length} active events`}>
                  {activeEvents.length}
                </Badge>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                {activeEvents.map((event) => (
                  <ActiveEventCard
                    key={event.id}
                    event={event}
                    canEdit={Boolean(leadershipProfile)}
                    canArchive={leadershipProfile?.role === "Admin"}
                    incompleteTaskCount={incompleteTaskCounts.get(event.id)}
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
                <Badge variant="neutral" aria-label={`${draftEvents.length} draft events`}>
                  {draftEvents.length}
                </Badge>
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

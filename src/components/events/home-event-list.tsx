"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import { CalendarDays, Pencil, RefreshCw } from "lucide-react";
import { EventBanner } from "@/components/events/event-banner";
import { EventCardMenu } from "@/components/events/event-card-menu";
import { HomeEventProgressSummary } from "@/components/events/home-event-progress";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadMoreControl } from "@/components/shared/load-more-control";
import { useInitialListEntrance } from "@/components/shared/motion";
import { StretchedLink } from "@/components/shared/stretched-link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useOffsetListPaging } from "@/hooks/use-offset-list-paging";
import {
  getVisibleActiveEventIds,
  HOME_EVENT_PROGRESS_RPC,
  markHomeEventProgressUnavailable,
  mergeHomeEventProgress,
} from "@/lib/events/home-event-progress";
import {
  HOME_EVENT_ORDER,
  splitHomeEvents,
  type HomeEvent,
} from "@/lib/events/list-paging";
import {
  LIST_FETCH_LIMIT,
  LIST_PAGE_SIZE,
  type OffsetListPage,
} from "@/lib/list-paging";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
  if (!event.end_date) return `Starts ${formatDate(event.start_date)}`;
  if (event.start_date === event.end_date) return formatDate(event.start_date);
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
  entranceClassName,
  onAnimationEnd,
}: {
  event: HomeEvent;
  canEdit: boolean;
  canArchive: boolean;
  entranceClassName?: string;
  onAnimationEnd: ReturnType<typeof useInitialListEntrance<HomeEvent>>["onAnimationEnd"];
}) {
  return (
    <Card
      className={cn(
        "motion-card-interaction group relative isolate overflow-hidden border-border/70 hover:border-primary/40 focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-ring/30",
        entranceClassName,
      )}
      onAnimationEnd={entranceClassName ? onAnimationEnd : undefined}
      data-motion-entrance-id={entranceClassName ? event.id : undefined}
    >
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
        incompleteTaskCount={event.incompleteTaskCount}
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
        <HomeEventProgressSummary
          eventName={event.name}
          progress={event.progress}
        />
        <div className="text-sm font-semibold text-primary group-hover:text-foreground group-focus-within:text-foreground">
          View board <span className="motion-arrow inline-block" aria-hidden>→</span>
        </div>
      </CardContent>
    </Card>
  );
}

function DraftEventCard({
  event,
  canEdit,
  entranceClassName,
  onAnimationEnd,
}: {
  event: HomeEvent;
  canEdit: boolean;
  entranceClassName?: string;
  onAnimationEnd: ReturnType<typeof useInitialListEntrance<HomeEvent>>["onAnimationEnd"];
}) {
  const lastEdited = formatLastEdited(event.updated_at);
  return (
    <Card
      className={cn(
        "relative border-2 border-dashed bg-card/70",
        entranceClassName,
      )}
      onAnimationEnd={entranceClassName ? onAnimationEnd : undefined}
      data-motion-entrance-id={entranceClassName ? event.id : undefined}
    >
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
                  suppressHydrationWarning
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
              <Pencil aria-hidden /> Edit
            </Link>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

async function addIncompleteTaskCounts(
  supabase: ReturnType<typeof createClient>,
  events: readonly HomeEvent[],
) {
  const visibleEvents = events.slice(0, LIST_PAGE_SIZE);
  const counts = await Promise.all(
    visibleEvents.map(async (event) => {
      if (event.status !== "Active") return { event, count: undefined };
      const { count, error } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .neq("status", "Completed");
      return { event, count: error || count === null ? undefined : count };
    }),
  );
  return [
    ...counts.map(({ event, count }) => ({
      ...event,
      incompleteTaskCount: count,
    })),
    ...events.slice(LIST_PAGE_SIZE),
  ];
}

async function addHomeEventProgress(
  supabase: ReturnType<typeof createClient>,
  events: readonly HomeEvent[],
  signal: AbortSignal,
) {
  const activeEventIds = getVisibleActiveEventIds(events);
  if (activeEventIds.length === 0) return [...events];

  try {
    let request = supabase.rpc(HOME_EVENT_PROGRESS_RPC, {
      p_event_ids: activeEventIds,
    });
    request = request.abortSignal(signal);
    const { data, error } = await request;
    if (signal.aborted) {
      throw error ?? new Error("Home progress request aborted.");
    }
    if (error) throw error;
    return mergeHomeEventProgress(events, data);
  } catch (error) {
    if (signal.aborted) throw error;
    console.error("Failed to load Home event progress:", error);
    return markHomeEventProgressUnavailable(events);
  }
}

export function HomeEventList({
  initialPage,
  canEdit,
  canArchive,
}: {
  initialPage?: OffsetListPage<HomeEvent>;
  canEdit: boolean;
  canArchive: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fetchPage = useCallback(
    async (offset: number, signal: AbortSignal) => {
      let request = supabase
        .from("events")
        .select(
          "id, name, description, start_date, end_date, status, banner_url, updated_at",
        )
        .in("status", ["Active", "Draft"])
        .order(HOME_EVENT_ORDER[0].column, {
          ascending: HOME_EVENT_ORDER[0].ascending,
        })
        .order(HOME_EVENT_ORDER[1].column, {
          ascending: HOME_EVENT_ORDER[1].ascending,
        })
        .order(HOME_EVENT_ORDER[2].column, {
          ascending: HOME_EVENT_ORDER[2].ascending,
        })
        .range(offset, offset + LIST_FETCH_LIMIT - 1)
        .returns<HomeEvent[]>();
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      const eventsWithProgress = await addHomeEventProgress(
        supabase,
        data ?? [],
        signal,
      );
      return canArchive
        ? addIncompleteTaskCounts(supabase, eventsWithProgress)
        : eventsWithProgress;
    },
    [canArchive, supabase],
  );
  const paging = useOffsetListPaging({
    active: true,
    fetchPage,
    getId: (event: HomeEvent) => event.id,
    identity: "home-events",
    initialPage,
    singularLabel: "event",
    pluralLabel: "events",
  });
  const { activeEvents, draftEvents } = splitHomeEvents(paging.items);
  const initialSplit = splitHomeEvents(initialPage?.items ?? []);
  const entrance = useInitialListEntrance({
    initialItems: [...initialSplit.activeEvents, ...initialSplit.draftEvents],
    items: [...activeEvents, ...draftEvents],
    settled: paging.settled,
    error: paging.error,
    getId: (event: HomeEvent) => event.id,
  });
  const hasCountWarning =
    canArchive &&
    activeEvents.some((event) => event.incompleteTaskCount === undefined);

  if (paging.isInitialLoading) {
    return (
      <Skeleton
        className="h-64 w-full rounded-xl"
        aria-label="Loading events"
      />
    );
  }
  if (paging.error && paging.items.length === 0) {
    return (
      <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
        <span>Events could not be loaded.</span>
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
  if (paging.settled && paging.items.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No events yet"
          description="When an event is launched—or you save your own draft—it will appear here."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-9">
      {hasCountWarning ? (
        <InlineAlert>
          Some archive actions are unavailable because incomplete-task counts
          could not be loaded.
        </InlineAlert>
      ) : null}
      {paging.error && paging.failedMode !== "append" ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Events could not refresh. The last successful result is still shown.
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
      {activeEvents.length ? (
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
            <Badge
              variant="neutral"
              aria-label={`${activeEvents.length} active events`}
            >
              {activeEvents.length}
            </Badge>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {activeEvents.map((event) => (
              <ActiveEventCard
                key={event.id}
                event={event}
                canEdit={canEdit}
                canArchive={canArchive}
                entranceClassName={entrance.getEntranceClassName(event.id)}
                onAnimationEnd={entrance.onAnimationEnd}
              />
            ))}
          </div>
        </section>
      ) : null}
      {draftEvents.length ? (
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
            <Badge
              variant="neutral"
              aria-label={`${draftEvents.length} draft events`}
            >
              {draftEvents.length}
            </Badge>
          </div>
          <div className="grid gap-4">
            {draftEvents.map((event) => (
              <DraftEventCard
                key={event.id}
                event={event}
                canEdit={canEdit}
                entranceClassName={entrance.getEntranceClassName(event.id)}
                onAnimationEnd={entrance.onAnimationEnd}
              />
            ))}
          </div>
        </section>
      ) : null}
      <LoadMoreControl
        announcement={paging.announcement}
        errorMessage={
          paging.failedMode === "append"
            ? "More events could not be loaded. The loaded events are still shown."
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

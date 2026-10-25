"use client";

import { useCallback, useMemo } from "react";
import { Archive, CalendarDays, ChevronRight, RefreshCw } from "lucide-react";
import { EventBanner } from "@/components/events/event-banner";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadMoreControl } from "@/components/shared/load-more-control";
import { useListReveal } from "@/components/shared/motion";
import { StretchedLink } from "@/components/shared/stretched-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useOffsetListPaging } from "@/hooks/use-offset-list-paging";
import {
  ARCHIVED_EVENT_ORDER,
  type ArchivedEvent,
} from "@/lib/events/list-paging";
import { LIST_FETCH_LIMIT, type OffsetListPage } from "@/lib/list-paging";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatDate(date: string) {
  return dateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function formatDateRange(event: ArchivedEvent) {
  if (!event.end_date || event.end_date === event.start_date) {
    return formatDate(event.start_date);
  }
  return `${formatDate(event.start_date)} – ${formatDate(event.end_date)}`;
}

export function ArchiveEventList({
  initialPage,
}: {
  initialPage?: OffsetListPage<ArchivedEvent>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const fetchPage = useCallback(
    async (offset: number, signal: AbortSignal) => {
      let request = supabase
        .from("events")
        .select("id, name, description, start_date, end_date, banner_url")
        .eq("status", "Archived")
        .order(ARCHIVED_EVENT_ORDER[0].column, {
          ascending: ARCHIVED_EVENT_ORDER[0].ascending,
        })
        .order(ARCHIVED_EVENT_ORDER[1].column, {
          ascending: ARCHIVED_EVENT_ORDER[1].ascending,
        })
        .order(ARCHIVED_EVENT_ORDER[2].column, {
          ascending: ARCHIVED_EVENT_ORDER[2].ascending,
        })
        .range(offset, offset + LIST_FETCH_LIMIT - 1)
        .returns<ArchivedEvent[]>();
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      return data ?? [];
    },
    [supabase],
  );
  const paging = useOffsetListPaging({
    active: true,
    fetchPage,
    getId: (event: ArchivedEvent) => event.id,
    identity: "archived-events",
    initialPage,
    singularLabel: "event",
    pluralLabel: "events",
  });
  const reveal = useListReveal({
    initialItems: initialPage?.items ?? [],
    items: paging.items,
    settled: paging.settled,
    error: paging.error,
    getId: (event: ArchivedEvent) => event.id,
  });

  if (paging.isInitialLoading) {
    return (
      <Skeleton
        className="h-48 w-full rounded-xl"
        aria-label="Loading archived events"
      />
    );
  }
  if (paging.error && paging.items.length === 0) {
    return (
      <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
        <span>Archived events could not be loaded.</span>
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
          title="No archived events yet"
          description="Events will appear here after an Admin archives them."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {paging.error && paging.failedMode !== "append" ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            Archived events could not refresh. The last successful result is
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
      <div className="grid gap-3">
        {paging.items.map((event) => (
          <Card
            key={event.id}
            {...reveal.getRevealProps(event.id)}
            className={cn(
              "motion-card-interaction group relative overflow-hidden hover:border-primary/40 hover:bg-muted/20 has-[a:focus-visible]:border-primary/50",
            )}
          >
            <StretchedLink
              href={`/archives/${event.id}`}
              label={`View ${event.name} archive`}
              className="transition-colors duration-[var(--motion-interaction-duration)] active:bg-muted/60 motion-reduce:transition-none"
            />
            <div className="flex flex-col sm:flex-row">
              <EventBanner
                src={event.banner_url}
                alt={`${event.name} banner`}
                loading="lazy"
                decoding="async"
                className="aspect-video w-full shrink-0 sm:w-52 lg:w-60"
              />
              <CardContent className="flex min-w-0 flex-1 items-start gap-3 p-4 sm:items-center">
                <span className="hidden size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground lg:flex">
                  <Archive className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-display text-base font-semibold leading-snug sm:text-lg">
                      {event.name}
                    </h2>
                    <Badge variant="neutral">Archived</Badge>
                  </div>
                  <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground sm:text-sm">
                    <CalendarDays
                      className="mt-0.5 size-3.5 shrink-0"
                      aria-hidden
                    />
                    <span>{formatDateRange(event)}</span>
                  </p>
                  {event.description ? (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {event.description}
                    </p>
                  ) : null}
                </div>
                <ChevronRight
                  className="motion-arrow mt-1 size-4 shrink-0 text-muted-foreground group-hover:text-foreground sm:mt-0"
                  aria-hidden
                />
              </CardContent>
            </div>
          </Card>
        ))}
      </div>
      <LoadMoreControl
        announcement={paging.announcement}
        errorMessage={
          paging.failedMode === "append"
            ? "More archived events could not be loaded. The loaded events are still shown."
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

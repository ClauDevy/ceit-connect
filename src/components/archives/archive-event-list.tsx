"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { CalendarDays, ChevronRight, RefreshCw, Search } from "lucide-react";
import { EventBanner } from "@/components/events/event-banner";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadMoreControl } from "@/components/shared/load-more-control";
import { useListReveal } from "@/components/shared/motion";
import { StretchedLink } from "@/components/shared/stretched-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IconInput } from "@/components/ui/icon-input";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOffsetListPaging } from "@/hooks/use-offset-list-paging";
import {
  ARCHIVED_EVENT_ORDER,
  type ArchivedEvent,
} from "@/lib/events/list-paging";
import { LIST_FETCH_LIMIT, type OffsetListPage } from "@/lib/list-paging";
import { createClient } from "@/lib/supabase/client";
import { formatShortDateRange } from "@/lib/format";

const ARCHIVE_SORT_LABELS = {
  newest: "Newest first",
  oldest: "Oldest first",
  name: "Name A–Z",
} as const;
type ArchiveSort = keyof typeof ARCHIVE_SORT_LABELS;

function formatDateRange(event: ArchivedEvent) {
  return formatShortDateRange(event.start_date, event.end_date);
}

export function ArchiveEventList({
  initialPage,
}: {
  initialPage?: OffsetListPage<ArchivedEvent>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<ArchiveSort>("newest");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);
  const fetchPage = useCallback(
    async (offset: number, signal: AbortSignal) => {
      let request = supabase
        .from("events")
        .select("id, name, description, start_date, end_date, banner_url")
        .eq("status", "Archived");
      if (search) {
        request = request.ilike("name", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
      }
      if (sort === "name") {
        request = request
          .order("name", { ascending: true })
          .order("id", { ascending: true });
      } else {
        const ascending = sort === "oldest";
        request = request
          .order(ARCHIVED_EVENT_ORDER[0].column, { ascending })
          .order(ARCHIVED_EVENT_ORDER[1].column, { ascending })
          .order(ARCHIVED_EVENT_ORDER[2].column, { ascending });
      }
      const { data, error } = await request
        .range(offset, offset + LIST_FETCH_LIMIT - 1)
        .abortSignal(signal)
        .returns<ArchivedEvent[]>();
      if (error) throw error;
      return data ?? [];
    },
    [supabase, search, sort],
  );
  const filtered = Boolean(search) || sort !== "newest";
  const paging = useOffsetListPaging({
    active: true,
    fetchPage,
    getId: (event: ArchivedEvent) => event.id,
    identity: `archived-events:${sort}:${search}`,
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

  const controls = (
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_200px]">
      <IconInput
        icon={Search}
        type="search"
        aria-label="Search archived events"
        placeholder="Search archived events…"
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
      />
      <Select
        items={ARCHIVE_SORT_LABELS}
        value={sort}
        onValueChange={(value) => setSort((value as ArchiveSort | null) ?? "newest")}
      >
        <SelectTrigger aria-label="Sort archived events">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(ARCHIVE_SORT_LABELS) as ArchiveSort[]).map((key) => (
            <SelectItem key={key} value={key}>
              {ARCHIVE_SORT_LABELS[key]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  let body: ReactNode = null;
  if (paging.isInitialLoading) {
    body = (
      <Skeleton
        className="h-48 w-full rounded-xl"
        aria-label="Loading archived events"
      />
    );
  }
  if (paging.error && paging.items.length === 0) {
    body = (
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
    body = (
      <EmptyState
          pose={filtered ? "searching" : "sleeping"}
          title={filtered ? "No archived events match" : "No archived events yet"}
          description={filtered ? "Try a different search or sort." : "Events will appear here after an Admin archives them."}
        />
    );
  }

  if (body === null) body = (
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
            interactive
            key={event.id}
            {...reveal.getRevealProps(event.id)}
            className="group relative overflow-hidden hover:bg-muted/20"
          >
            <StretchedLink
              href={`/archives/${event.id}`}
              label={`View ${event.name} archive`}
              className="transition-colors duration-[var(--motion-interaction-duration)] active:bg-muted/60 motion-reduce:transition-none"
            />
            <div className="flex items-center gap-3 p-3 sm:gap-4 sm:p-3.5">
              <EventBanner
                src={event.banner_url}
                alt={`${event.name} banner`}
                compact
                loading="lazy"
                decoding="async"
                className="aspect-video w-24 shrink-0 rounded-xl sm:w-36"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <h2 className="min-w-0 font-display text-base leading-snug font-semibold break-words line-clamp-2 sm:text-lg">
                    {event.name}
                  </h2>
                  <Badge variant="neutral">Archived</Badge>
                </div>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground sm:text-sm">
                  <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                  <span>{formatDateRange(event)}</span>
                </p>
                {event.description ? (
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {event.description}
                  </p>
                ) : null}
              </div>
              <ChevronRight
                className="motion-arrow size-4 shrink-0 text-muted-foreground group-hover:text-foreground"
                aria-hidden
              />
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
  return (
    <div className="space-y-4">
      {controls}
      {body}
    </div>
  );
}

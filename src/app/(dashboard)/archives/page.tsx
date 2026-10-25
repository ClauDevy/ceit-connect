import { Archive, CalendarDays, ChevronRight } from "lucide-react";
import { redirect } from "next/navigation";
import { EventBanner } from "@/components/events/event-banner";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StretchedLink } from "@/components/shared/stretched-link";
import { Badge } from "@/components/ui/badge";
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

export default async function ArchivesPage() {
  const profile = await getActiveProfileForRoles([
    "Admin",
    "Co-Admin",
    "Member",
  ]);
  if (!profile) redirect("/home");

  const supabase = await createClient();
  const { data: events, error } = await supabase
    .from("events")
    .select("id, name, description, start_date, end_date, banner_url")
    .eq("status", "Archived")
    .order("start_date", { ascending: false })
    .order("created_at", { ascending: false })
    .returns<ArchivedEvent[]>();

  if (error) {
    console.error("Failed to load Event Archives:", error);
  }

  return (
    <>
      <PageHeader
        title="Past Event Archives"
        description="Permanent, read-only records of past council events."
      />

      {error ? (
        <InlineAlert>
          Archived events could not be loaded. Refresh the page to try again.
        </InlineAlert>
      ) : events?.length ? (
        <div className="grid gap-3">
          {events.map((event) => (
            <Card
              key={event.id}
              className="group relative overflow-hidden transition-[background-color,border-color] duration-150 hover:border-primary/40 hover:bg-muted/20 has-[a:focus-visible]:border-primary/50 motion-reduce:transition-none"
            >
              <StretchedLink
                href={`/archives/${event.id}`}
                label={`View ${event.name} archive`}
                className="transition-colors duration-150 active:bg-muted/60 motion-reduce:transition-none"
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
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-colors duration-150 group-hover:text-foreground motion-reduce:transition-none sm:mt-0"
                    aria-hidden
                  />
                </CardContent>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="No archived events yet"
            description="Events will appear here after an Admin archives them."
          />
        </Card>
      )}
    </>
  );
}

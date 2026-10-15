import Link from "next/link";
import { Archive, ArrowRight, CalendarDays } from "lucide-react";
import { redirect } from "next/navigation";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
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
  const profile = await getActiveProfileForRoles(["Admin", "Co-Admin", "Member"]);
  if (!profile) redirect("/home");

  const supabase = await createClient();
  const { data: events, error } = await supabase
    .from("events")
    .select("id, name, description, start_date, end_date")
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
        <div className="grid gap-5 md:grid-cols-2">
          {events.map((event) => (
            <Card key={event.id} className="overflow-hidden">
              <CardContent className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                    <Archive className="size-5" aria-hidden />
                  </span>
                  <Badge variant="neutral">Archived</Badge>
                </div>
                <div>
                  <h2 className="font-display text-lg font-semibold leading-snug">
                    {event.name}
                  </h2>
                  <p className="mt-2 flex items-start gap-2 text-sm text-muted-foreground">
                    <CalendarDays className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span>{formatDateRange(event)}</span>
                  </p>
                  {event.description ? (
                    <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {event.description}
                    </p>
                  ) : null}
                </div>
                <Link
                  href={`/archives/${event.id}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  View record
                  <ArrowRight aria-hidden />
                </Link>
              </CardContent>
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

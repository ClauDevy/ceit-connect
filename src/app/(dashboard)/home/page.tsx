import Link from "next/link";
import { Plus } from "lucide-react";
import { HomeEventList } from "@/components/events/home-event-list";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { HOME_EVENT_ORDER, type HomeEvent } from "@/lib/events/list-paging";
import {
  LIST_FETCH_LIMIT,
  normalizeLookaheadPage,
  type OffsetListPage,
} from "@/lib/list-paging";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  await requireUser();

  const supabase = await createClient();
  const [leadershipProfile, eventsResult] = await Promise.all([
    getActiveProfileForRoles(["Admin", "Co-Admin"]),
    supabase
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
      .range(0, LIST_FETCH_LIMIT - 1)
      .returns<HomeEvent[]>(),
  ]);

  let initialPage: OffsetListPage<HomeEvent> | undefined;
  if (eventsResult.error) {
    console.error("Failed to load Home events:", eventsResult.error);
  } else {
    initialPage = normalizeLookaheadPage(eventsResult.data ?? [], 0);
  }

  const canEdit = Boolean(leadershipProfile);
  const canArchive = leadershipProfile?.role === "Admin";
  if (canArchive && initialPage) {
    const enriched = await Promise.all(
      initialPage.items.map(async (event) => {
        if (event.status !== "Active") return event;
        const { count, error } = await supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("event_id", event.id)
          .neq("status", "Completed");
        if (error || count === null) {
          console.error(
            `Failed to count incomplete tasks for event ${event.id}:`,
            error ?? new Error("Incomplete task count was not returned."),
          );
          return event;
        }
        return { ...event, incompleteTaskCount: count };
      }),
    );
    initialPage = { ...initialPage, items: enriched };
  }

  return (
    <>
      <PageHeader
        title="Home"
        description="Council events visible to you, ordered by their start date."
        actions={
          canEdit ? (
            <Link href="/events/new" className={buttonVariants()}>
              <Plus aria-hidden /> Create Event
            </Link>
          ) : null
        }
      />
      <HomeEventList
        initialPage={initialPage}
        canEdit={canEdit}
        canArchive={canArchive}
      />
    </>
  );
}

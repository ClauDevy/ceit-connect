import { redirect } from "next/navigation";
import { ArchiveEventList } from "@/components/archives/archive-event-list";
import { PageHeader } from "@/components/shared/page-header";
import { getActiveProfileForRoles } from "@/lib/auth";
import {
  ARCHIVED_EVENT_ORDER,
  type ArchivedEvent,
} from "@/lib/events/list-paging";
import {
  LIST_FETCH_LIMIT,
  normalizeLookaheadPage,
  type OffsetListPage,
} from "@/lib/list-paging";
import { createClient } from "@/lib/supabase/server";

export default async function ArchivesPage() {
  const profile = await getActiveProfileForRoles([
    "Admin",
    "Co-Admin",
    "Member",
  ]);
  if (!profile) redirect("/home");

  const supabase = await createClient();
  const { data, error } = await supabase
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
    .range(0, LIST_FETCH_LIMIT - 1)
    .returns<ArchivedEvent[]>();

  let initialPage: OffsetListPage<ArchivedEvent> | undefined;
  if (error) console.error("Failed to load Event Archives:", error);
  else initialPage = normalizeLookaheadPage(data ?? [], 0);

  return (
    <>
      <PageHeader
        title="Past Event Archives"
        description="Permanent, read-only records of past council events."
      />
      <ArchiveEventList initialPage={initialPage} />
    </>
  );
}

import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { InlineAlert } from "@/components/ui/inline-alert";
import { EventManagement } from "@/components/events/event-management";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { EventDeletionListItem } from "@/lib/events/event-deletion";

export default async function EventManagementPage() {
  await requireUser();
  const profile = await getActiveProfileForRoles(["Admin"]);
  if (!profile) redirect("/home");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .select("id, name, start_date, status, updated_at")
    .in("status", ["Draft", "Archived"])
    .order("start_date", { ascending: false, nullsFirst: false })
    .order("name", { ascending: true });

  if (error) console.error("Failed to load Event Management:", error.code);

  return (
    <div className="motion-content-ready">
      <PageHeader
        title="Event management"
        description="Permanently delete Draft or Archived events and retry pending banner cleanup. Active events cannot be deleted."
      />
      {error ? (
        <InlineAlert>Event Management could not be loaded. Refresh the page to try again.</InlineAlert>
      ) : (
        <EventManagement events={(data ?? []) as EventDeletionListItem[]} />
      )}
    </div>
  );
}

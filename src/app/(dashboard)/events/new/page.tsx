import { redirect } from "next/navigation";
import { EventForm } from "@/components/events/event-form";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/shared/page-header";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function CreateEventPage() {
  const user = await requireUser();
  const profile = await getActiveProfileForRoles(["Admin", "Co-Admin"]);

  if (!profile) {
    redirect("/home");
  }

  const supabase = await createClient();
  const [
    currentProfileResult,
    committeesResult,
    assigneesResult,
    archivedEventsResult,
  ] = await Promise.all([
    supabase
      .from("users")
      .select("role, committee_id")
      .eq("id", user.id)
      .single(),
    supabase.from("committees").select("id, name").order("name"),
    supabase.rpc("list_active_task_assignees"),
    supabase
      .from("events")
      .select("id, name, start_date")
      .eq("status", "Archived")
      .order("start_date", { ascending: false }),
  ]);

  const loadError =
    currentProfileResult.error ??
    committeesResult.error ??
    assigneesResult.error ??
    archivedEventsResult.error;

  if (loadError || !currentProfileResult.data) {
    console.error("Failed to load Create Event task options:", loadError);
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader
          title="Create Event"
          description="Set the event details and prepare its initial task backlog."
        />
        <InlineAlert>
          Task setup options could not be loaded. Refresh the page and try
          again.
        </InlineAlert>
      </div>
    );
  }

  const currentProfile = currentProfileResult.data;
  const committees = committeesResult.data ?? [];
  const taskCommittees = committees.filter(
    (committee) =>
      currentProfile.role === "Admin" ||
      committee.id === currentProfile.committee_id,
  );

  return (
    <EventForm
      role={currentProfile.role}
      committees={committees}
      taskCommittees={taskCommittees}
      assignees={assigneesResult.data ?? []}
      archivedTemplates={(archivedEventsResult.data ?? []).map((event) => ({
        id: event.id,
        name: event.name,
        startDate: event.start_date,
      }))}
    />
  );
}

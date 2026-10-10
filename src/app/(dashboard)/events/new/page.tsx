import { redirect } from "next/navigation";
import { CreateEventForm } from "@/app/(dashboard)/events/new/create-event-form";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";

export default async function CreateEventPage() {
  await requireUser();
  const profile = await getActiveProfileForRoles(["Admin", "Co-Admin"]);

  if (!profile) {
    redirect("/home");
  }

  return <CreateEventForm />;
}

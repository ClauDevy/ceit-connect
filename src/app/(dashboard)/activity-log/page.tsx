import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { getActiveProfileForRoles } from "@/lib/auth";

// Intentionally empty: this page's content hasn't been built yet.
export default async function ActivityLogPage() {
  const profile = await getActiveProfileForRoles(["Admin"]);

  if (!profile) {
    redirect("/home");
  }

  return <PageHeader title="Activity Log" />;
}

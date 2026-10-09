import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// Intentionally empty: this page's content hasn't been built yet.
export default async function DashboardPage() {
  const supabase = await createClient();
  const user = await requireUser();
  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "Admin" && profile?.role !== "Co-Admin") {
    redirect("/home");
  }

  return <PageHeader title="Executive Dashboard" />;
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/sidebar";
import type { CurrentUser } from "@/lib/types";
import { BfcacheGuard } from "@/components/bfcache-guard";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Step 1: is anyone actually logged in?
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Step 2: pull their app-specific profile (role, committee) from our
  // own `users` table — auth.users only knows their email, not their
  // role in the council.
  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name, role, committee_id, avatar_url")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // A real auth account exists, but no matching profile row —
    // shouldn't normally happen (the invite flow creates both together),
    // but fail safely instead of crashing the whole layout.
    redirect("/login?error=no_profile");
  }

  const currentUser: CurrentUser = {
    id: profile.id,
    name: profile.full_name,
    role: profile.role,
    committeeId: profile.committee_id,
    avatarUrl: profile.avatar_url,
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <BfcacheGuard />
      <Sidebar user={currentUser} />
      <main className="flex-1 overflow-y-auto overflow-x-hidden bg-slate-50 p-6">
        {children}
      </main>
    </div>
  );
}

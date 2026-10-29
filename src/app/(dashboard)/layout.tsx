import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { AppShell } from "@/components/layout/app-shell";
import type { CurrentUser } from "@/lib/types";
import { BfcacheGuard } from "@/components/bfcache-guard";
import { QueryProvider } from "@/components/query-provider";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Step 1: is anyone actually logged in? (shared with the page below via cache)
  const user = await requireUser();

  // Step 2: pull their app-specific profile (role, committee, active
  // status) from our own `users` table — auth.users only knows their
  // email, not their role in the council.
  const { data: profile } = await supabase
    .from("users")
    .select("id, full_name, role, committee_id, avatar_url, is_active, password_set")
    .eq("id", user.id)
    .single();

  if (!profile) {
    // A real auth account exists, but no matching profile row —
    // shouldn't normally happen (the invite flow creates both together),
    // but fail safely instead of crashing the whole layout.
    redirect("/login?error=no_profile");
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    redirect("/login?error=deactivated");
  }

  const currentUser: CurrentUser = {
    id: profile.id,
    name: profile.full_name,
    role: profile.role,
    committeeId: profile.committee_id,
    avatarUrl: profile.avatar_url,
    passwordSet: profile.password_set,
  };

  return (
    <>
      <BfcacheGuard />
      <QueryProvider>
        <AppShell user={currentUser}>{children}</AppShell>
      </QueryProvider>
    </>
  );
}

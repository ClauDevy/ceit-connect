import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";
import { UsersTable } from "@/components/users/users-table";

export default async function UsersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: me } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (me?.role !== "Admin") {
    redirect("/home");
  }

  const { data: committees } = await supabase
    .from("committees")
    .select("id, name")
    .order("name");

  const { data: members } = await supabase
    .from("users")
    .select("id, full_name, email, role, committee_id, is_active")
    .order("full_name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-foreground">Users</h1>
        <InviteUserDialog committees={committees ?? []} />
      </div>

      <UsersTable
        members={members ?? []}
        committees={committees ?? []}
        currentUserId={user!.id}
      />
    </div>
  );
}
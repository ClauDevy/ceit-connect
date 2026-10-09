import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { UsersTable } from "@/components/users/users-table";

export default async function UsersPage() {
  const supabase = await createClient();

  const user = await requireUser();

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
    <div>
      <PageHeader
        title="User management"
        description="Invite council members, set their roles, and deactivate the roster at the end of the year."
        actions={<InviteUserDialog committees={committees ?? []} />}
      />

      <UsersTable
        members={members ?? []}
        committees={committees ?? []}
        currentUserId={user.id}
      />
    </div>
  );
}

import { createClient } from "@/lib/supabase/server";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";

export default async function UsersPage() {
  const supabase = await createClient();

  const { data: committees } = await supabase
    .from("committees")
    .select("id, name")
    .order("name");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
        <InviteUserDialog committees={committees ?? []} />
      </div>

      <p className="text-sm text-slate-500">
        Member list coming soon — for now, use Invite User above to add new council members.
      </p>
    </div>
  );
}
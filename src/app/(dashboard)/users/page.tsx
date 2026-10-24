import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { UsersTable } from "@/components/users/users-table";
import { InlineAlert } from "@/components/ui/inline-alert";

export default async function UsersPage() {
  const user = await requireUser();
  const profile = await getActiveProfileForRoles(["Admin"]);
  if (!profile) {
    redirect("/home");
  }

  const supabase = await createClient();

  const [committeesResult, membersResult] = await Promise.all([
    supabase.from("committees").select("id, name").order("name"),
    supabase
      .from("users")
      .select(
        "id, full_name, email, role, committee_id, avatar_url, is_active",
      )
      .order("full_name"),
  ]);

  const loadFailed = Boolean(committeesResult.error || membersResult.error);
  if (loadFailed) {
    console.error("Failed to load User Management data", {
      committees: committeesResult.error,
      members: membersResult.error,
    });
  }

  return (
    <div>
      <PageHeader
        title="User management"
        description="Invite council members, set their roles, and deactivate the roster at the end of the year."
        actions={
          loadFailed ? null : (
            <InviteUserDialog committees={committeesResult.data ?? []} />
          )
        }
      />

      {loadFailed ? (
        <InlineAlert>
          User Management could not be loaded. Refresh the page to try again.
        </InlineAlert>
      ) : (
        <UsersTable
          members={membersResult.data ?? []}
          committees={committeesResult.data ?? []}
          currentUserId={user.id}
        />
      )}
    </div>
  );
}

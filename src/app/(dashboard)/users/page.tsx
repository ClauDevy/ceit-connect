import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { InviteUserDialog } from "@/components/users/invite-user-dialog";
import { InviteOfficersDialog } from "@/components/users/invite-officers-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { UsersTable } from "@/components/users/users-table";
import { InlineAlert } from "@/components/ui/inline-alert";
import { normalizeLookaheadPage } from "@/lib/list-paging";
import { listUsersPage } from "@/lib/users/list-users";
import type { PendingOfficerInvite } from "@/lib/types";

export default async function UsersPage() {
  const user = await requireUser();
  const profile = await getActiveProfileForRoles(["Admin"]);
  if (!profile) {
    redirect("/home");
  }

  const supabase = await createClient();

  const [committeesResult, membersResult, pendingResult] = await Promise.all([
    supabase.from("committees").select("id, name").order("name"),
    listUsersPage(supabase, {
      committees: [],
      offset: 0,
      search: "",
      status: "active",
    }),
    supabase.rpc("list_pending_officer_invites"),
  ]);

  const loadFailed = Boolean(committeesResult.error || membersResult.error);
  if (loadFailed) {
    console.error("Failed to load User Management data", {
      committees: committeesResult.error,
      members: membersResult.error,
    });
  }

  return (
    <div className="motion-content-ready">
      <PageHeader
        title="User management"
        description="Invite council members, set their roles, and deactivate the roster at the end of the year."
        actions={
          loadFailed ? null : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <InviteOfficersDialog committees={committeesResult.data ?? []} />
              <InviteUserDialog committees={committeesResult.data ?? []} />
            </div>
          )
        }
      />

      {loadFailed ? (
        <InlineAlert>
          User Management could not be loaded. Refresh the page to try again.
        </InlineAlert>
      ) : (
        <UsersTable
          initialPage={normalizeLookaheadPage(membersResult.data ?? [], 0)}
          committees={committeesResult.data ?? []}
          currentUserId={user.id}
          initialPendingInvites={
            pendingResult.error
              ? []
              : ((pendingResult.data ?? []) as PendingOfficerInvite[])
          }
          initialPendingError={Boolean(pendingResult.error)}
        />
      )}
    </div>
  );
}

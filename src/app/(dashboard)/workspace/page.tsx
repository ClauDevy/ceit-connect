import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { WorkspaceTasks } from "@/components/tasks/workspace-tasks";
import { TaskLeaveRequests } from "@/components/tasks/task-leave-requests";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import {
  getHelpWantedRpcArgs,
  isHelpWantedTask,
  type HelpWantedTask,
} from "@/lib/tasks/backup";
import { getMyTasksRpcArgs, isMyTask, type MyTask } from "@/lib/tasks/my-tasks";
import { normalizeLookaheadPage, type OffsetListPage } from "@/lib/list-paging";
import { createClient } from "@/lib/supabase/server";

export default async function WorkspacePage() {
  await requireUser();
  const profile = await getActiveProfileForRoles([
    "Admin",
    "Co-Admin",
    "Member",
  ]);
  if (!profile) redirect("/home");

  const supabase = await createClient();
  const [myTasksResult, helpWantedResult] = await Promise.all([
    supabase.rpc("list_my_tasks", getMyTasksRpcArgs(null, "deadline", 0)),
    supabase.rpc("list_help_wanted_tasks", getHelpWantedRpcArgs(0)),
  ]);

  let initialMyTasksPage: OffsetListPage<MyTask> | undefined;
  if (myTasksResult.error) {
    console.error("Failed to load My Tasks:", myTasksResult.error);
  } else if (
    Array.isArray(myTasksResult.data) &&
    myTasksResult.data.every(isMyTask)
  ) {
    initialMyTasksPage = normalizeLookaheadPage(myTasksResult.data, 0);
  } else {
    console.error("My Tasks returned invalid data.");
  }

  let initialHelpWantedPage: OffsetListPage<HelpWantedTask> | undefined;
  if (helpWantedResult.error) {
    console.error("Failed to load Help Wanted tasks:", helpWantedResult.error);
  } else if (
    Array.isArray(helpWantedResult.data) &&
    helpWantedResult.data.every(isHelpWantedTask)
  ) {
    initialHelpWantedPage = normalizeLookaheadPage(helpWantedResult.data, 0);
  } else {
    console.error("Help Wanted tasks returned invalid data.");
  }

  return (
    <div className="space-y-6 md:space-y-7">
      <PageHeader
        title="Workspace"
        description="Everything assigned to you, and everywhere the council needs a hand."
      />
      {profile.role !== "Member" ? <TaskLeaveRequests /> : null}
      <WorkspaceTasks
        viewerRole={profile.role}
        initialMyTasksPage={initialMyTasksPage}
        initialHelpWantedPage={initialHelpWantedPage}
      />
    </div>
  );
}

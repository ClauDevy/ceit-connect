import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { WorkspaceTasks } from "@/components/tasks/workspace-tasks";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import {
  HELP_WANTED_PAGE_SIZE,
  isHelpWantedTask,
  type HelpWantedTask,
} from "@/lib/tasks/backup";
import { getMyTasksRpcArgs, isMyTask, type MyTask } from "@/lib/tasks/my-tasks";
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
    supabase.rpc("list_help_wanted_tasks", {
      p_limit: HELP_WANTED_PAGE_SIZE,
      p_offset: 0,
    }),
  ]);

  let initialMyTasks: MyTask[] | undefined;
  if (myTasksResult.error) {
    console.error("Failed to load My Tasks:", myTasksResult.error);
  } else if (
    Array.isArray(myTasksResult.data) &&
    myTasksResult.data.every(isMyTask)
  ) {
    initialMyTasks = myTasksResult.data;
  } else {
    console.error("My Tasks returned invalid data.");
  }

  let initialHelpWantedTasks: HelpWantedTask[] | undefined;
  if (helpWantedResult.error) {
    console.error("Failed to load Help Wanted tasks:", helpWantedResult.error);
  } else if (
    Array.isArray(helpWantedResult.data) &&
    helpWantedResult.data.every(isHelpWantedTask)
  ) {
    initialHelpWantedTasks = helpWantedResult.data;
  } else {
    console.error("Help Wanted tasks returned invalid data.");
  }

  return (
    <div className="space-y-6 md:space-y-7">
      <PageHeader
        title="Workspace"
        description="Everything assigned to you, and everywhere the council needs a hand."
      />
      <WorkspaceTasks
        initialMyTasks={initialMyTasks}
        initialHelpWantedTasks={initialHelpWantedTasks}
      />
    </div>
  );
}

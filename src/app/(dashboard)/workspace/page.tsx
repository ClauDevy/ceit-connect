import { redirect } from "next/navigation";
import { HelpWantedList } from "@/components/tasks/help-wanted-list";
import { PageHeader } from "@/components/shared/page-header";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import {
  HELP_WANTED_PAGE_SIZE,
  isHelpWantedTask,
  type HelpWantedTask,
} from "@/lib/tasks/backup";
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
  const { data, error } = await supabase.rpc("list_help_wanted_tasks", {
    p_limit: HELP_WANTED_PAGE_SIZE,
    p_offset: 0,
  });

  let initialTasks: HelpWantedTask[] | undefined;
  if (error) {
    console.error("Failed to load Help Wanted tasks:", error);
  } else if (Array.isArray(data) && data.every(isHelpWantedTask)) {
    initialTasks = data;
  } else {
    console.error("Help Wanted tasks returned invalid data.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Find active tasks that need an extra pair of hands."
      />
      <section aria-labelledby="help-wanted-title" className="space-y-4">
        <div>
          <h2 id="help-wanted-title" className="font-display text-xl font-semibold">
            Help Wanted
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Volunteer for tasks you can fully access from any committee.
          </p>
        </div>
        <HelpWantedList initialTasks={initialTasks} />
      </section>
    </div>
  );
}

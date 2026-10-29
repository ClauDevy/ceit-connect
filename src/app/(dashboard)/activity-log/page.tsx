import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityLogPageClient } from "@/components/activity-log/activity-log-page";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_ACTIVITY_FILTERS,
  GLOBAL_ACTIVITY_LOG_PAGE_SIZE,
  activityLogRetentionNotice,
  activityErrorCode,
  activityFiltersToRpc,
  activityWindowFromPage,
  normalizeActivityResponse,
  unavailableActivityWindow,
} from "@/lib/activity-log";

export default async function ActivityLogPage() {
  await requireUser();
  const profile = await getActiveProfileForRoles(["Admin", "Co-Admin"]);

  if (!profile) {
    redirect("/home");
  }
  const supabase = await createClient();
  const [activityResult, committeesResult] = await Promise.all([
    supabase.rpc(
      "list_activity_log",
      activityFiltersToRpc(
        DEFAULT_ACTIVITY_FILTERS,
        null,
        null,
        GLOBAL_ACTIVITY_LOG_PAGE_SIZE,
      ),
    ),
    supabase.from("committees").select("id, name").order("name"),
  ]);
  if (activityResult.error) console.error("Failed to prefetch activity log:", activityResult.error);
  if (committeesResult.error) console.error("Failed to load activity committees:", committeesResult.error);
  let initialWindow = activityWindowFromPage({ rows: [], hasMore: false, cursor: null });
  const initialLoadFailed = Boolean(activityResult.error);
  if (activityErrorCode(activityResult.error) === "CAL01") {
    initialWindow = unavailableActivityWindow();
  }
  if (!activityResult.error) {
    try { initialWindow = activityWindowFromPage(normalizeActivityResponse(activityResult.data)); }
    catch (error) { console.error("Activity log returned invalid initial data:", error); }
  }
  return <div className="space-y-5"><PageHeader title="Activity Log" description="A secure, read-only history of task activity." /><p className="text-sm text-muted-foreground">{activityLogRetentionNotice()}</p><ActivityLogPageClient initialWindow={initialWindow} initialLoadFailed={initialLoadFailed} committees={committeesResult.data ?? []} /></div>;
}

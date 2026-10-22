import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import {
  isTaskDetail,
  type TaskDetail as TaskDetailData,
} from "@/lib/tasks/detail";
import {
  isTaskEditControlData,
  type TaskEditControlData,
} from "@/lib/tasks/edit-controls";
import {
  isTaskWorkLinks,
  type TaskWorkLinks,
} from "@/lib/tasks/work-links";
import {
  isTaskBackupState,
  type TaskBackupState,
} from "@/lib/tasks/backup";
import {
  isTaskAssigneeWorkload,
  type TaskAssigneeWorkload,
} from "@/lib/tasks/workload";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function TaskData({ taskId }: { taskId: string }) {
  const supabase = await createClient();
  const [
    detailResult,
    workLinksResult,
    editControlsResult,
    backupStateResult,
    workloadResult,
  ] = await Promise.all([
    supabase.rpc("get_task_detail", { p_task_id: taskId }),
    supabase.rpc("get_task_work_links", { p_task_id: taskId }),
    supabase.rpc("get_task_edit_controls", { p_task_id: taskId }),
    supabase.rpc("get_task_backup_state", { p_task_id: taskId }),
    supabase.rpc("list_active_task_assignees_with_workload"),
  ]);

  if (detailResult.error) {
    console.error("Failed to load task detail:", detailResult.error);
    return <TaskDetail taskId={taskId} />;
  }

  let initialTask: TaskDetailData | null | undefined;
  if (Array.isArray(detailResult.data) && detailResult.data.length === 0) {
    initialTask = null;
  } else if (
    Array.isArray(detailResult.data) &&
    detailResult.data.length === 1 &&
    isTaskDetail(detailResult.data[0])
  ) {
    initialTask = detailResult.data[0];
  } else {
    console.error("Task detail returned invalid data.");
  }

  let initialWorkLinks: TaskWorkLinks | null | undefined;
  if (workLinksResult.error) {
    console.error("Failed to load task work links:", workLinksResult.error);
  } else if (
    Array.isArray(workLinksResult.data) &&
    workLinksResult.data.length === 0
  ) {
    initialWorkLinks = null;
  } else if (
    Array.isArray(workLinksResult.data) &&
    workLinksResult.data.length === 1 &&
    isTaskWorkLinks(workLinksResult.data[0])
  ) {
    initialWorkLinks = workLinksResult.data[0];
  } else {
    console.error("Task work links returned invalid data.");
  }

  let initialEditControls: TaskEditControlData | null | undefined;
  if (editControlsResult.error) {
    console.error("Failed to load task edit controls:", editControlsResult.error);
  } else if (
    Array.isArray(editControlsResult.data) &&
    editControlsResult.data.length === 0
  ) {
    initialEditControls = null;
  } else if (
    Array.isArray(editControlsResult.data) &&
    editControlsResult.data.length === 1 &&
    isTaskEditControlData(editControlsResult.data[0])
  ) {
    initialEditControls = editControlsResult.data[0];
  } else {
    console.error("Task edit controls returned invalid data.");
  }

  let initialBackupState: TaskBackupState | null | undefined;
  if (backupStateResult.error) {
    console.error("Failed to load task backup state:", backupStateResult.error);
  } else if (
    Array.isArray(backupStateResult.data) &&
    backupStateResult.data.length === 0
  ) {
    initialBackupState = null;
  } else if (
    Array.isArray(backupStateResult.data) &&
    backupStateResult.data.length === 1 &&
    isTaskBackupState(backupStateResult.data[0])
  ) {
    initialBackupState = backupStateResult.data[0];
  } else {
    console.error("Task backup state returned invalid data.");
  }

  let initialWorkloads: TaskAssigneeWorkload[] | undefined;
  if (workloadResult.error) {
    console.error("Failed to load task assignee workload:", workloadResult.error);
  } else if (
    Array.isArray(workloadResult.data) &&
    workloadResult.data.every(isTaskAssigneeWorkload)
  ) {
    initialWorkloads = workloadResult.data;
  } else {
    console.error("Task assignee workload returned invalid data.");
  }

  return (
    <TaskDetail
      taskId={taskId}
      initialTask={initialTask}
      initialWorkLinks={initialWorkLinks}
      initialEditControls={initialEditControls}
      initialBackupState={initialBackupState}
      initialWorkloads={initialWorkloads}
    />
  );
}

export default async function TaskDetailPage({
  params,
}: PageProps<"/tasks/[taskId]">) {
  await requireUser();
  const profile = await getActiveProfileForRoles([
    "Admin",
    "Co-Admin",
    "Member",
  ]);
  if (!profile) redirect("/home");

  const { taskId } = await params;
  if (!UUID_PATTERN.test(taskId)) {
    return <TaskDetail taskId={taskId} initialTask={null} canFetch={false} />;
  }

  return (
    <Suspense fallback={<TaskDetailSkeleton />}>
      <TaskData taskId={taskId} />
    </Suspense>
  );
}

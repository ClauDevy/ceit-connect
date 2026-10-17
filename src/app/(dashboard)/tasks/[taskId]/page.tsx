import { Suspense } from "react";
import { redirect } from "next/navigation";
import { TaskDetail } from "@/components/tasks/task-detail";
import { TaskDetailSkeleton } from "@/components/tasks/task-detail-skeleton";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import {
  isTaskDetail,
  type TaskDetail as TaskDetailData,
} from "@/lib/tasks/detail";
import { createClient } from "@/lib/supabase/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function TaskData({ taskId }: { taskId: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_task_detail", {
    p_task_id: taskId,
  });

  if (error) {
    console.error("Failed to load task detail:", error);
    return <TaskDetail taskId={taskId} />;
  }

  let initialTask: TaskDetailData | null | undefined;
  if (Array.isArray(data) && data.length === 0) {
    initialTask = null;
  } else if (
    Array.isArray(data) &&
    data.length === 1 &&
    isTaskDetail(data[0])
  ) {
    initialTask = data[0];
  } else {
    console.error("Task detail returned invalid data.");
  }

  return <TaskDetail taskId={taskId} initialTask={initialTask} />;
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

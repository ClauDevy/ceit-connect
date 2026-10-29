import { redirect } from "next/navigation";
import {
  EventForm,
  type InitialEventTask,
} from "@/components/events/event-form";
import { PageHeader } from "@/components/shared/page-header";
import { InlineAlert } from "@/components/ui/inline-alert";
import { getActiveProfileForRoles, requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isCanonicalUuid } from "@/lib/uuid";
import { splitAppTimestamp } from "@/lib/timezone";
import {
  isTaskAssigneeWorkload,
  toEventAssigneeOption,
} from "@/lib/tasks/workload";

type EditableEvent = {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  status: "Draft" | "Active" | "Archived";
  updated_at: string;
  banner_url: string | null;
};

type EditableTaskMetadata = {
  id: string;
  committee_id: string;
  phase: string | null;
  status: "To Do" | "In Progress" | "Completed";
  priority: "Low" | "Medium" | "High" | "Critical";
  task_type: "Deliverable" | "LiveOperation";
  due_date: string | null;
  call_time: string | null;
  end_time: string | null;
  primary_assignees: string[];
};

function LoadError() {
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Edit Event"
        description="Update the event details and its task backlog."
      />
      <InlineAlert>
        The event could not be loaded. Refresh the page and try again.
      </InlineAlert>
    </div>
  );
}

export default async function EditEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ eventId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const leadershipProfile = await getActiveProfileForRoles([
    "Admin",
    "Co-Admin",
  ]);

  if (!leadershipProfile) {
    redirect("/home");
  }

  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  if (!isCanonicalUuid(eventId)) {
    redirect("/home");
  }

  const supabase = await createClient();
  const eventResult = await supabase
    .from("events")
    .select(
      "id, name, description, start_date, end_date, status, updated_at, banner_url",
    )
    .eq("id", eventId)
    .maybeSingle<EditableEvent>();

  if (eventResult.error) {
    console.error("Failed to load event for editing:", eventResult.error);
    return <LoadError />;
  }

  if (!eventResult.data || eventResult.data.status === "Archived") {
    redirect("/home");
  }

  const [currentProfileResult, committeesResult, assigneesResult, tasksResult] =
    await Promise.all([
      supabase
        .from("users")
        .select("role, committee_id")
        .eq("id", user.id)
        .single(),
      supabase.from("committees").select("id, name").order("name"),
      supabase.rpc("list_active_task_assignees_with_workload"),
      supabase
        .from("tasks")
        .select(
          "id, committee_id, phase, status, priority, task_type, due_date, call_time, end_time, primary_assignees",
        )
        .eq("event_id", eventId)
        .order("created_at", { ascending: true })
        .returns<EditableTaskMetadata[]>(),
    ]);

  const loadError =
    currentProfileResult.error ??
    committeesResult.error ??
    assigneesResult.error ??
    tasksResult.error;

  const workloadRows: unknown = assigneesResult.data;
  const workloadDataInvalid =
    !assigneesResult.error &&
    (!Array.isArray(workloadRows) ||
      !workloadRows.every(isTaskAssigneeWorkload));

  if (loadError || workloadDataInvalid || !currentProfileResult.data) {
    console.error("Failed to load Edit Event options:", loadError);
    return <LoadError />;
  }

  // The raw task query deliberately excludes title and description. Those
  // fields always pass through get_task() so its confidentiality rules remain
  // the single read path for sensitive task content.
  const taskDetailResults = await Promise.all(
    (tasksResult.data ?? []).map((task) =>
      supabase.rpc("get_task", { p_task_id: task.id }).single(),
    ),
  );
  const taskDetailError = taskDetailResults.find(
    (result) => result.error,
  )?.error;

  if (taskDetailError) {
    console.error("Failed to load editable task details:", taskDetailError);
    return <LoadError />;
  }

  const taskDetails = new Map(
    taskDetailResults
      .map((result) => result.data)
      .filter(
        (
          task,
        ): task is { id: string; title: string; description: string | null } =>
          Boolean(task),
      )
      .map((task) => [task.id, task]),
  );

  const initialTasks: InitialEventTask[] = (tasksResult.data ?? []).map(
    (task) => {
      const details = taskDetails.get(task.id);
      const call = splitAppTimestamp(task.call_time) ?? { date: "", time: "" };
      const end = splitAppTimestamp(task.end_time) ?? { date: "", time: "" };

      return {
        id: task.id,
        title: details?.title ?? "Confidential Task",
        description: details?.description ?? "",
        phase: task.phase?.trim() || "Unphased",
        committeeId: task.committee_id,
        taskType: task.task_type,
        dueDate: task.due_date?.slice(0, 10) ?? "",
        callDate: call.date,
        callTime: call.time,
        endTime: end.time,
        priority: task.priority,
        assigneeIds: task.primary_assignees,
        status: task.status,
      };
    },
  );

  const currentProfile = currentProfileResult.data;
  const committees = committeesResult.data ?? [];
  const taskCommittees = committees.filter(
    (committee) =>
      currentProfile.role === "Admin" ||
      committee.id === currentProfile.committee_id,
  );

  return (
    <EventForm
      currentUserId={user.id}
      role={currentProfile.role}
      committees={committees}
      taskCommittees={taskCommittees}
      assignees={
        Array.isArray(workloadRows)
          ? workloadRows.filter(isTaskAssigneeWorkload).map(toEventAssigneeOption)
          : []
      }
      bannerNotice={
        query.banner === "failed"
          ? "The event was saved, but its banner could not be uploaded. Try adding it again here."
          : undefined
      }
      initialEvent={{
        id: eventResult.data.id,
        name: eventResult.data.name,
        description: eventResult.data.description ?? "",
        startDate: eventResult.data.start_date,
        endDate: eventResult.data.end_date ?? "",
        status: eventResult.data.status,
        // Preserve the exact Supabase string; never round-trip through Date.
        updatedAt: eventResult.data.updated_at,
        bannerUrl: eventResult.data.banner_url,
        tasks: initialTasks,
      }}
    />
  );
}

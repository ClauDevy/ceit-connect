import { formatDateSafe } from "@/lib/safe-date";
import { getEventTaskEndDateInputValue } from "@/lib/events/form";
import { parseDraftPhaseCompletionState } from "@/lib/tasks/phase-completion";
import type {
  DraftEditorTask,
  InitialEventTask,
  PhaseDraft,
  Priority,
  TaskDraft,
  TaskType,
} from "@/components/events/event-form-types";

export const priorities: Priority[] = ["Low", "Medium", "High", "Critical"];
export const priorityItems = priorities.map((priority) => ({
  value: priority,
  label: priority,
}));
export const taskTypes: { value: TaskType; label: string }[] = [
  { value: "Deliverable", label: "Deliverable" },
  { value: "LiveOperation", label: "Live Operation" },
];

const friendlyDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

export function friendlyDate(value: string) {
  return formatDateSafe(friendlyDateFormatter, value, value);
}

export function makeId() {
  return crypto.randomUUID();
}

export function parseDraftEditorTask(value: unknown): DraftEditorTask | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!(typeof row.out_task_id === "string" &&
    typeof row.out_phase === "string" &&
    typeof row.out_title === "string" &&
    typeof row.out_is_masked === "boolean" &&
    typeof row.out_is_editable === "boolean")) return null;
  return { ...(row as Omit<DraftEditorTask, "phaseComplete" | "canReopen" | "reopenUpdatedAt">), ...parseDraftPhaseCompletionState(row) };
}

export function makeInitialPhases(tasks: InitialEventTask[]): PhaseDraft[] {
  const phases = new Map<string, TaskDraft[]>();

  for (const task of tasks) {
    const phaseName = task.phase;
    const phaseTasks = phases.get(phaseName) ?? [];
    phaseTasks.push({
      id: task.id,
      persisted: true,
      status: task.status,
      title: task.title,
      description: task.description,
      committeeId: task.committeeId,
      taskType: task.taskType,
      dueDate: task.dueDate,
      callDate: task.callDate,
      callTime: task.callTime,
      endDate: getEventTaskEndDateInputValue({
        callDate: task.callDate,
        endDate: task.endDate,
        endTime: task.endTime,
      }),
      endTime: task.endTime,
      priority: task.priority,
      assigneeIds: task.assigneeIds,
      sourceTemplateTaskId: null,
      templateEditable: true,
    });
    phases.set(phaseName, phaseTasks);
  }

  return Array.from(phases, ([name, phaseTasks], index) => ({
    id: `persisted-phase-${index}`,
    name,
    originalName: name,
    origin: "persisted" as const,
    collapsed: false,
    tasks: phaseTasks,
  }));
}

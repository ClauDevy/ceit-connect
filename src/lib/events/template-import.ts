import { splitAppTimestamp } from "../timezone";
import { isCanonicalUuid } from "../uuid";

export type TemplateTaskType = "Deliverable" | "LiveOperation";
export type TemplateTaskPriority = "Low" | "Medium" | "High" | "Critical";

export type ImportedTemplateTask = {
  sourceTaskId: string;
  title: string;
  description: string;
  phaseName: string;
  committeeId: string;
  taskType: TemplateTaskType;
  priority: TemplateTaskPriority;
  dueDate: string;
  callDate: string;
  callTime: string;
  endDate: string;
  endTime: string;
};

const priorities: TemplateTaskPriority[] = [
  "Low",
  "Medium",
  "High",
  "Critical",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTemplateDueDate(value: string | null) {
  if (value === null) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = splitAppTimestamp(value);
    return parsed?.date === value ? value : null;
  }
  return splitAppTimestamp(value)?.date ?? null;
}

function parseNullableSchedule(value: string | null) {
  return value === null ? { date: "", time: "" } : splitAppTimestamp(value);
}

export function parseArchivedTemplateTasks(
  value: unknown,
): ImportedTemplateTask[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: ImportedTemplateTask[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;

    const {
      source_task_id: sourceTaskId,
      title,
      description,
      phase,
      committee_id: committeeId,
      task_type: taskType,
      priority,
      due_date: dueDate,
      call_time: callTime,
      end_time: endTime,
      status,
      assignee_ids: assigneeIds,
    } = item;

    if (
      !isCanonicalUuid(sourceTaskId) ||
      typeof title !== "string" ||
      !(description === null || typeof description === "string") ||
      !(phase === null || typeof phase === "string") ||
      !isCanonicalUuid(committeeId) ||
      !(taskType === "Deliverable" || taskType === "LiveOperation") ||
      !priorities.includes(priority as TemplateTaskPriority) ||
      !(dueDate === null || typeof dueDate === "string") ||
      !(callTime === null || typeof callTime === "string") ||
      !(endTime === null || typeof endTime === "string") ||
      status !== "To Do" ||
      !Array.isArray(assigneeIds) ||
      assigneeIds.length !== 0
    ) {
      return null;
    }

    const due = parseTemplateDueDate(dueDate);
    const call = parseNullableSchedule(callTime);
    const end = parseNullableSchedule(endTime);
    if (due === null || !call || !end) return null;
    if (endTime !== null && callTime === null) return null;

    parsed.push({
      sourceTaskId: sourceTaskId.toLowerCase(),
      title,
      description: description ?? "",
      phaseName: phase?.trim() || "Unphased",
      committeeId: committeeId.toLowerCase(),
      taskType,
      priority: priority as TemplateTaskPriority,
      dueDate: due,
      callDate: call.date,
      callTime: call.time,
      endDate: end.date,
      endTime: end.time,
    });
  }

  return parsed;
}

export function removeTemplateDerivedTasks<
  TTask extends { sourceTemplateTaskId: string | null },
  TPhase extends { tasks: TTask[] },
>(phases: TPhase[]) {
  return phases.map((phase) => ({
    ...phase,
    tasks: phase.tasks.filter((task) => task.sourceTemplateTaskId === null),
  }));
}

export function shouldUseCoAdminTemplateCreate({
  hasInitialEvent,
  role,
  hasTemplateSummary,
}: {
  hasInitialEvent: boolean;
  role: "Admin" | "Co-Admin";
  hasTemplateSummary: boolean;
}) {
  return !hasInitialEvent && role === "Co-Admin" && hasTemplateSummary;
}

export function isTemplateTaskEditable({
  role,
  callerCommitteeId,
  taskCommitteeId,
}: {
  role: "Admin" | "Co-Admin";
  callerCommitteeId: string | null;
  taskCommitteeId: string;
}) {
  return role === "Admin" ||
    (callerCommitteeId !== null &&
      callerCommitteeId.toLowerCase() === taskCommitteeId.toLowerCase());
}

export function normalizeTemplateExclusionIds(values: unknown) {
  if (!Array.isArray(values) || values.length > 200) return null;

  const normalized = new Set<string>();
  for (const value of values) {
    if (!isCanonicalUuid(value)) return null;
    normalized.add(value.toLowerCase());
  }
  return [...normalized].sort();
}

import { splitAppTimestamp, toAppTimestamp } from "../timezone";

type TaskPayloadDraft = {
  title: string;
  description: string;
  committeeId: string;
  taskType: "Deliverable" | "LiveOperation";
  dueDate: string;
  callDate: string;
  callTime: string;
  endTime: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  assigneeIds: string[];
};

export function parseImportedDueDate(value: string | null) {
  return splitAppTimestamp(value);
}

export function toTaskPayload(phaseName: string, task: TaskPayloadDraft) {
  return {
    title: task.title,
    description: task.description || null,
    phase: phaseName.trim(),
    committee_id: task.committeeId,
    task_type: task.taskType,
    due_date: task.dueDate || null,
    call_time:
      task.taskType === "LiveOperation"
        ? toAppTimestamp(task.callDate, task.callTime)
        : null,
    end_time:
      task.taskType === "LiveOperation"
        ? toAppTimestamp(task.callDate, task.endTime)
        : null,
    priority: task.priority,
    assignee_ids: task.assigneeIds,
  };
}

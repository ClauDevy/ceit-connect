import type { Committee, Role } from "@/lib/types";

export type AssigneeOption = {
  id: string;
  full_name: string;
  committee_id: string | null;
  avatar_url: string | null;
  activeTaskCount: number;
};

export type ArchivedEventTemplate = {
  id: string;
  name: string;
  startDate: string;
};

export type TaskType = "Deliverable" | "LiveOperation";
export type Priority = "Low" | "Medium" | "High" | "Critical";
export type TaskStatus = "To Do" | "In Progress" | "Completed";

export type TaskDraft = {
  id: string;
  persisted: boolean;
  status: TaskStatus;
  title: string;
  description: string;
  committeeId: string;
  taskType: TaskType;
  dueDate: string;
  callDate: string;
  callTime: string;
  endDate: string;
  endTime: string;
  priority: Priority;
  assigneeIds: string[];
  sourceTemplateTaskId: string | null;
  templateEditable: boolean;
};

export type PhaseDraft = {
  id: string;
  name: string;
  originalName: string;
  origin: "persisted" | "local" | "reader-shell";
  collapsed: boolean;
  tasks: TaskDraft[];
};

export type DraftEditorTask = {
  out_task_id: string;
  out_phase: string;
  out_status: "To Do" | "In Progress" | "Completed";
  out_title: string;
  out_description: string | null;
  out_committee_name: string | null;
  out_is_masked: boolean;
  out_is_editable: boolean;
  phaseComplete: boolean;
  canReopen: boolean;
  reopenUpdatedAt: string | null;
};

export type PhaseAction =
  | { key: string; type: "rename"; phase: string; next_phase: string }
  | { key: string; type: "delete"; phase: string };

export type TaskEditor = {
  phaseId: string;
  taskId: string | null;
  draft: Omit<TaskDraft, "id" | "persisted" | "status">;
};

export type InitialEventTask = {
  id: string;
  title: string;
  description: string;
  phase: string;
  committeeId: string;
  taskType: TaskType;
  dueDate: string;
  callDate: string;
  callTime: string;
  endDate: string;
  endTime: string;
  priority: Priority;
  assigneeIds: string[];
  status: TaskStatus;
};

export type InitialEvent = {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: "Draft" | "Active";
  updatedAt: string;
  bannerUrl: string | null;
  phaseOrder: string[];
  tasks: InitialEventTask[];
};

export type EventFormProps = {
  currentUserId: string;
  role: Extract<Role, "Admin" | "Co-Admin">;
  committees: Committee[];
  taskCommittees: Committee[];
  assignees: AssigneeOption[];
  archivedTemplates?: ArchivedEventTemplate[];
  initialEvent?: InitialEvent;
  bannerNotice?: string;
};

export type TemplateImportResult = {
  template_name: string;
  template_start_date: string;
  tasks: unknown;
  imported_task_count: number;
  skipped_confidential_count: number;
};

export type TemplateImportSummary = {
  template: ArchivedEventTemplate;
  importedStartDate: string;
  importedTaskCount: number;
  skippedConfidentialCount: number;
  applied: boolean;
};

export type PendingTemplateImport = {
  template: ArchivedEventTemplate;
  reason: "replace" | "reimport";
};

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Archive,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  FileText,
  LoaderCircle,
  ListChecks,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  Collapse,
  MotionPresence,
  SectionEnter,
  TabPanel,
} from "@/components/shared/motion";
import { PageHeader } from "@/components/shared/page-header";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { TigerLogo } from "@/components/ui/tiger-logo";
import { BannerUploader } from "@/components/events/banner-uploader";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { uploadEventBanner } from "@/lib/event-banner";
import {
  parseImportedDueDate,
  toTaskPayload,
} from "@/lib/events/form";
import { getEventSaveErrorMessage } from "@/lib/events/save-error";
import { preventSearchFormSubmission } from "@/lib/search";
import { SUCCESS_ANIMATION_NAME } from "@/lib/motion";
import { splitAppTimestamp } from "@/lib/timezone";
import type { Committee, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

type AssigneeOption = {
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

type TaskType = "Deliverable" | "LiveOperation";
type Priority = "Low" | "Medium" | "High" | "Critical";
type TaskStatus = "To Do" | "In Progress" | "Completed";

type TaskDraft = {
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
  endTime: string;
  priority: Priority;
  assigneeIds: string[];
};

type PhaseDraft = {
  id: string;
  name: string;
  collapsed: boolean;
  tasks: TaskDraft[];
};

type DraftEditorTask = {
  out_task_id: string;
  out_phase: string;
  out_status: "To Do" | "In Progress" | "Completed";
  out_title: string;
  out_description: string | null;
  out_committee_name: string | null;
  out_is_masked: boolean;
  out_is_editable: boolean;
};

type PhaseAction =
  | { key: string; type: "rename"; phase: string; next_phase: string }
  | { key: string; type: "delete"; phase: string };

function isDraftEditorTask(value: unknown): value is DraftEditorTask {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.out_task_id === "string" &&
    typeof row.out_phase === "string" &&
    typeof row.out_title === "string" &&
    typeof row.out_is_masked === "boolean" &&
    typeof row.out_is_editable === "boolean";
}

type TaskEditor = {
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
  tasks: InitialEventTask[];
};

type EventFormProps = {
  currentUserId: string;
  role: Extract<Role, "Admin" | "Co-Admin">;
  committees: Committee[];
  taskCommittees: Committee[];
  assignees: AssigneeOption[];
  archivedTemplates?: ArchivedEventTemplate[];
  initialEvent?: InitialEvent;
  bannerNotice?: string;
};

type TemplateImportResult = {
  template_name: string;
  template_start_date: string;
  tasks: unknown;
  imported_task_count: number;
  skipped_confidential_count: number;
};

type TemplateImportSummary = {
  template: ArchivedEventTemplate;
  importedStartDate: string;
  importedTaskCount: number;
  skippedConfidentialCount: number;
  skippedUnsupportedScheduleCount: number;
  applied: boolean;
};

type PendingTemplateImport = {
  template: ArchivedEventTemplate;
  reason: "replace" | "reimport";
};

type ImportedTaskDraft = {
  phaseName: string;
  task: TaskDraft;
};

type ParsedImportedTasks = {
  tasks: ImportedTaskDraft[];
  skippedUnsupportedScheduleCount: number;
};

const priorities: Priority[] = ["Low", "Medium", "High", "Critical"];
const priorityItems = priorities.map((priority) => ({
  value: priority,
  label: priority,
}));
const taskTypes: { value: TaskType; label: string }[] = [
  { value: "Deliverable", label: "Deliverable" },
  { value: "LiveOperation", label: "Live Operation" },
];

function makeId() {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseImportedTasks(value: unknown): ParsedImportedTasks | null {
  if (!Array.isArray(value)) return null;

  const parsedTasks: ImportedTaskDraft[] = [];
  let skippedUnsupportedScheduleCount = 0;
  for (const item of value) {
    if (!isRecord(item)) return null;

    const {
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
      typeof title !== "string" ||
      !(description === null || typeof description === "string") ||
      !(phase === null || typeof phase === "string") ||
      typeof committeeId !== "string" ||
      !(taskType === "Deliverable" || taskType === "LiveOperation") ||
      !priorities.includes(priority as Priority) ||
      !(dueDate === null || typeof dueDate === "string") ||
      !(callTime === null || typeof callTime === "string") ||
      !(endTime === null || typeof endTime === "string") ||
      status !== "To Do" ||
      !Array.isArray(assigneeIds) ||
      assigneeIds.length !== 0
    ) {
      return null;
    }

    const due = parseImportedDueDate(dueDate);
    const call = splitAppTimestamp(callTime);
    const end = splitAppTimestamp(endTime);
    if (!due || !call || !end) return null;

    if (
      taskType === "LiveOperation" &&
      endTime !== null &&
      (callTime === null || end.date !== call.date)
    ) {
      skippedUnsupportedScheduleCount += 1;
      continue;
    }

    parsedTasks.push({
      phaseName: phase?.trim() || "Unphased",
      task: {
        id: makeId(),
        persisted: false,
        status: "To Do",
        title,
        description: description ?? "",
        committeeId,
        taskType,
        dueDate: due.date,
        callDate: call.date,
        callTime: call.time,
        endTime: end.time,
        priority: priority as Priority,
        assigneeIds: [],
      },
    });
  }

  return { tasks: parsedTasks, skippedUnsupportedScheduleCount };
}

function makeInitialPhases(tasks: InitialEventTask[]): PhaseDraft[] {
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
      endTime: task.endTime,
      priority: task.priority,
      assigneeIds: task.assigneeIds,
    });
    phases.set(phaseName, phaseTasks);
  }

  return Array.from(phases, ([name, phaseTasks], index) => ({
    id: `persisted-phase-${index}`,
    name,
    collapsed: false,
    tasks: phaseTasks,
  }));
}

export function EventForm({
  currentUserId,
  role,
  committees,
  taskCommittees,
  assignees,
  archivedTemplates = [],
  initialEvent,
  bannerNotice,
}: EventFormProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"fundamentals" | "tasks">("fundamentals");
  const [tabMotionKey, setTabMotionKey] = useState(0);
  const [name, setName] = useState(initialEvent?.name ?? "");
  const [description, setDescription] = useState(
    initialEvent?.description ?? "",
  );
  const [startDate, setStartDate] = useState(initialEvent?.startDate ?? "");
  const [endDate, setEndDate] = useState(initialEvent?.endDate ?? "");
  const [bannerUrl, setBannerUrl] = useState(initialEvent?.bannerUrl ?? null);
  const [pendingBanner, setPendingBanner] = useState<File | null>(null);
  const [eventVersion, setEventVersion] = useState(
    initialEvent?.updatedAt ?? "",
  );
  const [showBannerNotice, setShowBannerNotice] = useState(
    Boolean(bannerNotice),
  );
  const [phases, setPhases] = useState<PhaseDraft[]>(() =>
    initialEvent ? makeInitialPhases(initialEvent.tasks) : [],
  );
  const [phaseActions, setPhaseActions] = useState<PhaseAction[]>([]);
  const [deletedTaskIds, setDeletedTaskIds] = useState<string[]>([]);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [taskEditor, setTaskEditor] = useState<TaskEditor | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskEditorError, setTaskEditorError] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [phaseToRemove, setPhaseToRemove] = useState<PhaseDraft | null>(null);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState("");
  const [templateMode, setTemplateMode] = useState<"scratch" | "archive">(
    "scratch",
  );
  const [templateMotionKey, setTemplateMotionKey] = useState(0);
  const [savedTaskId, setSavedTaskId] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateStatus, setTemplateStatus] = useState<"idle" | "loading">(
    "idle",
  );
  const [templateError, setTemplateError] = useState("");
  const [templateSummary, setTemplateSummary] =
    useState<TemplateImportSummary | null>(null);
  const [pendingTemplateImport, setPendingTemplateImport] =
    useState<PendingTemplateImport | null>(null);
  const taskDialogScrollRef = useRef<HTMLDivElement>(null);

  const draftReaderQuery = useQuery({
    queryKey: ["draft-event-editor-tasks", initialEvent?.id],
    enabled: initialEvent?.status === "Draft",
    queryFn: async ({ signal }) => {
      const supabase = createClient();
      let request = supabase.rpc("list_draft_event_editor_tasks", {
        p_event_id: initialEvent!.id,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isDraftEditorTask)) {
        throw new Error("The Draft overview returned an invalid response.");
      }
      return data;
    },
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const readOnlyTasks = useMemo(
    () => (draftReaderQuery.data ?? []).filter((task) => !task.out_is_editable),
    [draftReaderQuery.data],
  );
  const readOnlyTasksByPhase = useMemo(() => {
    const grouped = new Map<string, DraftEditorTask[]>();
    for (const task of readOnlyTasks) {
      const rows = grouped.get(task.out_phase) ?? [];
      rows.push(task);
      grouped.set(task.out_phase, rows);
    }
    return grouped;
  }, [readOnlyTasks]);

  const taskCount = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  const nameSet = name.trim().length > 0;
  const startSet = startDate.length > 0;
  const datesSet = startSet && endDate.length > 0;
  const datesOutOfOrder = datesSet && endDate < startDate;
  const phasesValid = phases.every(
    (phase) => phase.tasks.length === 0 || phase.name.trim().length > 0,
  );
  const readyToLaunch =
    nameSet &&
    datesSet &&
    !datesOutOfOrder &&
    (initialEvent ? true : taskCount > 0) &&
    phasesValid;

  const initialTaskPayloads = useMemo(
    () =>
      new Map(
        (initialEvent?.tasks ?? []).map((task) => [
          task.id,
          JSON.stringify(toTaskPayload(task.phase, task)),
        ]),
      ),
    [initialEvent],
  );

  const datesChanged = Boolean(
    initialEvent &&
    (startDate !== initialEvent.startDate || endDate !== initialEvent.endDate),
  );
  const tasksOutsideDateRange = datesChanged
    ? phases.flatMap((phase) =>
        phase.tasks.filter(
          (task) =>
            task.dueDate &&
            startDate &&
            (task.dueDate < startDate ||
              Boolean(endDate && task.dueDate > endDate)),
        ),
      )
    : [];

  const filteredArchivedTemplates = useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase();
    if (!query) return archivedTemplates;
    return archivedTemplates.filter((template) =>
      template.name.toLocaleLowerCase().includes(query),
    );
  }, [archivedTemplates, templateSearch]);

  const importedStartDateChanged = Boolean(
    templateSummary?.applied && startDate !== templateSummary.importedStartDate,
  );

  const committeeItems = taskCommittees.map((committee) => ({
    value: committee.id,
    label: committee.name,
  }));

  const committeeNames = useMemo(
    () =>
      new Map(committees.map((committee) => [committee.id, committee.name])),
    [committees],
  );

  const assigneeGroups = useMemo(() => {
    if (!taskEditor) return { selected: [], other: [] };

    const query = assigneeSearch.trim().toLocaleLowerCase();
    const matchesSearch = (assignee: AssigneeOption) => {
      const committeeName = assignee.committee_id
        ? (committeeNames.get(assignee.committee_id) ?? "")
        : "No committee";
      return `${assignee.full_name} ${committeeName}`
        .toLocaleLowerCase()
        .includes(query);
    };
    const byName = (left: AssigneeOption, right: AssigneeOption) =>
      left.full_name.localeCompare(right.full_name);
    const actorIsStored = taskEditor.draft.assigneeIds.includes(currentUserId);
    const filtered = assignees.filter(
      (assignee) =>
        (assignee.id !== currentUserId || actorIsStored) &&
        matchesSearch(assignee),
    );

    return {
      selected: filtered
        .filter(
          (assignee) => assignee.committee_id === taskEditor.draft.committeeId,
        )
        .sort(byName),
      other: filtered
        .filter(
          (assignee) => assignee.committee_id !== taskEditor.draft.committeeId,
        )
        .sort((left, right) => {
          const committeeOrder = (
            left.committee_id
              ? (committeeNames.get(left.committee_id) ?? "")
              : "No committee"
          ).localeCompare(
            right.committee_id
              ? (committeeNames.get(right.committee_id) ?? "")
              : "No committee",
          );
          return committeeOrder || byName(left, right);
        }),
    };
  }, [assigneeSearch, assignees, committeeNames, currentUserId, taskEditor]);

  const selectedCommitteeHasActiveMembers = taskEditor
    ? assignees.some(
        (assignee) => assignee.committee_id === taskEditor.draft.committeeId,
      )
    : false;

  const activeAssigneeIds = useMemo(
    () => new Set(assignees.map((assignee) => assignee.id)),
    [assignees],
  );
  const inactiveAssigneeIds = taskEditor
    ? taskEditor.draft.assigneeIds.filter(
        (assigneeId) => !activeAssigneeIds.has(assigneeId),
      )
    : [];
  const visibleAssignees = assigneeGroups.selected;
  const visibleAssigneeIds = new Set(
    visibleAssignees.map((assignee) => assignee.id),
  );
  const selectedVisibleAssigneeCount = taskEditor
    ? visibleAssignees.filter((assignee) =>
        taskEditor.draft.assigneeIds.includes(assignee.id),
      ).length
    : 0;
  const allVisibleAssigneesSelected =
    visibleAssignees.length > 0 &&
    selectedVisibleAssigneeCount === visibleAssignees.length;
  const selectedWithAllVisibleCount = taskEditor
    ? new Set([...taskEditor.draft.assigneeIds, ...visibleAssigneeIds]).size
    : 0;
  const selectAllVisibleExceedsLimit =
    !allVisibleAssigneesSelected && selectedWithAllVisibleCount > 100;

  function selectFormTab(nextTab: "fundamentals" | "tasks") {
    if (nextTab === tab) return;
    setTab(nextTab);
    setTabMotionKey((current) => current + 1);
  }

  function selectTemplateMode(nextMode: "scratch" | "archive") {
    if (nextMode === templateMode) return;
    setTemplateMode(nextMode);
    setTemplateMotionKey((current) => current + 1);
  }

  async function importTemplate(template: ArchivedEventTemplate) {
    if (!startDate) {
      setTemplateError(
        "Set the new event start date before importing a template.",
      );
      setTab("fundamentals");
      return;
    }

    setTemplateStatus("loading");
    setTemplateError("");

    try {
      const supabase = createClient();
      const result = await supabase
        .rpc("get_archived_event_template", {
          p_template_event_id: template.id,
          p_new_start_date: startDate,
        })
        .single<TemplateImportResult>();

      if (result.error) {
        setTemplateError(result.error.message);
        return;
      }

      const data = result.data;
      if (
        !data ||
        typeof data.template_name !== "string" ||
        typeof data.template_start_date !== "string" ||
        !Number.isInteger(data.imported_task_count) ||
        data.imported_task_count < 0 ||
        !Number.isInteger(data.skipped_confidential_count) ||
        data.skipped_confidential_count < 0
      ) {
        setTemplateError("The archive template returned an invalid response.");
        return;
      }

      const parsedImport = parseImportedTasks(data.tasks);
      if (
        !parsedImport ||
        parsedImport.tasks.length +
          parsedImport.skippedUnsupportedScheduleCount !==
          data.imported_task_count
      ) {
        setTemplateError("The archive template returned invalid task data.");
        return;
      }
      const importedTasks = parsedImport.tasks;

      const summary: TemplateImportSummary = {
        template: {
          ...template,
          name: data.template_name,
          startDate: data.template_start_date,
        },
        importedStartDate: startDate,
        importedTaskCount: importedTasks.length,
        skippedConfidentialCount: data.skipped_confidential_count,
        skippedUnsupportedScheduleCount:
          parsedImport.skippedUnsupportedScheduleCount,
        applied: importedTasks.length > 0,
      };

      if (importedTasks.length === 0) {
        setTemplateSummary(summary);
        return;
      }

      const tasksByPhase = new Map<string, TaskDraft[]>();
      for (const importedTask of importedTasks) {
        const phaseTasks = tasksByPhase.get(importedTask.phaseName) ?? [];
        phaseTasks.push(importedTask.task);
        tasksByPhase.set(importedTask.phaseName, phaseTasks);
      }

      setPhases(
        Array.from(tasksByPhase, ([phaseName, phaseTasks]) => ({
          id: makeId(),
          name: phaseName,
          collapsed: false,
          tasks: phaseTasks,
        })),
      );
      setDeletedTaskIds([]);
      setTaskEditor(null);
      setTemplateSummary(summary);
      setError("");
      setTab("tasks");
    } catch {
      setTemplateError("Network error, please try importing again.");
    } finally {
      setTemplateStatus("idle");
    }
  }

  function requestTemplateImport(
    template: ArchivedEventTemplate,
    reason: PendingTemplateImport["reason"] = "replace",
  ) {
    if (!startDate) {
      setTemplateError(
        "Set the new event start date before importing a template.",
      );
      setTab("fundamentals");
      return;
    }

    if (reason === "reimport" || taskCount > 0) {
      setPendingTemplateImport({ template, reason });
      return;
    }

    void importTemplate(template);
  }

  function addPhase() {
    const phaseName = newPhaseName.trim();
    if (!phaseName) {
      setError("Give the phase a name before adding it.");
      return;
    }
    if (phaseName.length > 100) {
      setError("Phase names cannot exceed 100 characters.");
      return;
    }

    setPhases((current) => [
      ...current,
      { id: makeId(), name: phaseName, collapsed: false, tasks: [] },
    ]);
    setNewPhaseName("");
    setError("");
  }

  function updatePhaseName(phaseId: string, phaseName: string) {
    const currentPhase = phases.find((phase) => phase.id === phaseId);
    if (currentPhase && currentPhase.name !== phaseName) {
      setPhaseActions((current) => {
        const existing = current.find(
          (action) => action.key === phaseId && action.type === "rename",
        );
        if (existing?.type === "rename") {
          return current.map((action) =>
            action === existing ? { ...existing, next_phase: phaseName } : action,
          );
        }
        return [...current, { key: phaseId, type: "rename", phase: currentPhase.name, next_phase: phaseName }];
      });
    }
    setPhases((current) =>
      current.map((phase) =>
        phase.id === phaseId ? { ...phase, name: phaseName } : phase,
      ),
    );
  }

  function togglePhase(phaseId: string) {
    setPhases((current) =>
      current.map((phase) =>
        phase.id === phaseId
          ? { ...phase, collapsed: !phase.collapsed }
          : phase,
      ),
    );
  }

  function openNewTask(phaseId: string) {
    if (taskCount >= 200) {
      setError("An event can contain at most 200 tasks.");
      return;
    }

    setTaskEditorError("");
    setAssigneeSearch("");
    setTaskEditor({
      phaseId,
      taskId: null,
      draft: {
        title: "",
        description: "",
        committeeId: taskCommittees[0]?.id ?? "",
        taskType: "Deliverable",
        dueDate: "",
        callDate: "",
        callTime: "",
        endTime: "",
        priority: "Medium",
        assigneeIds: [],
      },
    });
    setTaskDialogOpen(true);
  }

  function openEditTask(phaseId: string, task: TaskDraft) {
    setTaskEditorError("");
    setAssigneeSearch("");
    setTaskEditor({
      phaseId,
      taskId: task.id,
      draft: {
        title: task.title,
        description: task.description,
        committeeId: task.committeeId,
        taskType: task.taskType,
        dueDate: task.dueDate,
        callDate: task.callDate,
        callTime: task.callTime,
        endTime: task.endTime,
        priority: task.priority,
        assigneeIds: task.assigneeIds,
      },
    });
    setTaskDialogOpen(true);
  }

  function closeTaskDialog() {
    setTaskDialogOpen(false);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setTaskEditor(null);
    }
  }

  function updateTaskDraft(updates: Partial<TaskEditor["draft"]>) {
    setTaskEditor((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...updates } }
        : current,
    );
  }

  function updateVisibleAssignees(checked: boolean) {
    setTaskEditor((current) => {
      if (!current) return current;

      if (!checked) {
        return {
          ...current,
          draft: {
            ...current.draft,
            assigneeIds: current.draft.assigneeIds.filter(
              (assigneeId) => !visibleAssigneeIds.has(assigneeId),
            ),
          },
        };
      }

      const uniqueIds = new Set(current.draft.assigneeIds);
      visibleAssigneeIds.forEach((assigneeId) => uniqueIds.add(assigneeId));
      if (uniqueIds.size > 100) return current;

      const missingVisibleIds = [...visibleAssigneeIds].filter(
        (assigneeId) => !current.draft.assigneeIds.includes(assigneeId),
      );
      return {
        ...current,
        draft: {
          ...current.draft,
          assigneeIds: [
            ...current.draft.assigneeIds,
            ...missingVisibleIds,
          ],
        },
      };
    });
  }

  function saveTask() {
    if (!taskEditor) return;

    const revealTaskProblem = (field: string, message: string) => {
      setTaskEditorError(message);
      requestAnimationFrame(() => {
        const control = taskDialogScrollRef.current?.querySelector<HTMLElement>(
          `[data-task-field="${field}"]`,
        );
        control?.scrollIntoView({ block: "center" });
        control?.focus();
      });
    };

    const title = taskEditor.draft.title.trim();
    if (!title) {
      revealTaskProblem("title", "Give the task a title.");
      return;
    }
    if (!taskEditor.draft.committeeId) {
      revealTaskProblem("committee", "Choose a committee.");
      return;
    }
    if (
      taskEditor.draft.taskType === "LiveOperation" &&
      (taskEditor.draft.callDate ||
        taskEditor.draft.callTime ||
        taskEditor.draft.endTime) &&
      (!taskEditor.draft.callDate || !taskEditor.draft.callTime)
    ) {
      revealTaskProblem(
        !taskEditor.draft.callDate ? "call-date" : "call-time",
        "Choose both a duty date and call time when adding a live-duty schedule.",
      );
      return;
    }
    if (
      taskEditor.draft.taskType === "LiveOperation" &&
      taskEditor.draft.callTime &&
      taskEditor.draft.endTime &&
      taskEditor.draft.endTime < taskEditor.draft.callTime
    ) {
      revealTaskProblem("end-time", "End time cannot be before call time.");
      return;
    }

    const existingTask = taskEditor.taskId
      ? phases
          .find((phase) => phase.id === taskEditor.phaseId)
          ?.tasks.find((task) => task.id === taskEditor.taskId)
      : null;
    const savedTask: TaskDraft = {
      id: taskEditor.taskId ?? makeId(),
      persisted: existingTask?.persisted ?? false,
      status: existingTask?.status ?? "To Do",
      ...taskEditor.draft,
      title,
      description: taskEditor.draft.description.trim(),
    };

    setPhases((current) =>
      current.map((phase) => {
        if (phase.id !== taskEditor.phaseId) return phase;
        return {
          ...phase,
          tasks: taskEditor.taskId
            ? phase.tasks.map((task) =>
                task.id === taskEditor.taskId ? savedTask : task,
              )
            : [...phase.tasks, savedTask],
        };
      }),
    );
    setSavedTaskId(savedTask.id);
    closeTaskDialog();
    setTaskEditorError("");
    setError("");
  }

  function removeTask(phaseId: string, taskId: string) {
    const task = phases
      .find((phase) => phase.id === phaseId)
      ?.tasks.find((item) => item.id === taskId);

    if (!task) return;
    if (task.status !== "To Do") {
      setError(
        `“${task.title}” cannot be deleted because its status is ${task.status}.`,
      );
      return;
    }

    if (task.persisted) {
      setDeletedTaskIds((current) =>
        current.includes(task.id) ? current : [...current, task.id],
      );
    }
    setPhases((current) =>
      current.map((phase) =>
        phase.id === phaseId
          ? {
              ...phase,
              tasks: phase.tasks.filter((task) => task.id !== taskId),
            }
          : phase,
      ),
    );
    setError("");
  }

  function requestRemovePhase(phase: PhaseDraft) {
    const progressedTask = phase.tasks.find((task) => task.status !== "To Do");
    if (progressedTask) {
      setError(
        `This phase cannot be removed because “${progressedTask.title}” is ${progressedTask.status}.`,
      );
      setTab("tasks");
      return;
    }

    setPhaseToRemove(phase);
  }

  async function handleSave(launch: boolean) {
    if (!nameSet) {
      setError("Give the event a name first.");
      setTab("fundamentals");
      return;
    }
    if (!startSet) {
      setError("Pick a start date first — even drafts need one.");
      setTab("fundamentals");
      return;
    }
    if (datesOutOfOrder) {
      setError("The end date cannot be before the start date.");
      setTab("fundamentals");
      return;
    }
    if (launch && !datesSet) {
      setError("Set both a start and end date before launching.");
      setTab("fundamentals");
      return;
    }
    if (launch && !initialEvent && taskCount === 0) {
      setError("Add at least one task before launching.");
      setTab("tasks");
      return;
    }
    if (!phasesValid) {
      setError("Every phase containing tasks needs a name.");
      setTab("tasks");
      return;
    }

    setStatus("saving");
    setError("");

    const tasks = phases.flatMap((phase) =>
      phase.tasks.map((task) => ({
        task,
        payload: toTaskPayload(phase.name, task),
      })),
    );

    try {
      const supabase = createClient();
      const targetStatus = launch
        ? "Active"
        : (initialEvent?.status ?? "Draft");
      const saveResult = initialEvent
        ? await supabase.rpc("edit_event_with_tasks", {
            p_event_id: initialEvent.id,
            // Keep the exact server string. Converting through Date can lose
            // precision and break the optimistic-concurrency comparison.
            p_expected_updated_at: eventVersion,
            p_name: name.trim(),
            p_description: description.trim() || null,
            p_start_date: startDate,
            p_end_date: endDate || null,
            p_status: targetStatus,
            p_tasks_to_add: tasks
              .filter(({ task }) => !task.persisted)
              .map(({ payload }) => payload),
            p_tasks_to_update: tasks
              .filter(
                ({ task, payload }) =>
                  task.persisted &&
                  initialTaskPayloads.get(task.id) !== JSON.stringify(payload),
              )
              .map(({ task, payload }) => ({ id: task.id, ...payload })),
            p_task_ids_to_delete: deletedTaskIds,
            p_phase_actions: phaseActions.map((action) =>
              action.type === "rename"
                ? { type: action.type, phase: action.phase, next_phase: action.next_phase }
                : { type: action.type, phase: action.phase },
            ),
          })
        : await supabase.rpc("create_event_with_tasks", {
            p_name: name.trim(),
            p_description: description.trim() || null,
            p_start_date: startDate,
            p_end_date: endDate || null,
            p_status: targetStatus,
            p_tasks: tasks.map(({ payload }) => payload),
          });
      const saveError = saveResult.error;

      if (saveError) {
        setError(getEventSaveErrorMessage(saveError));
        setStatus("idle");
        return;
      }

      if (!initialEvent && pendingBanner) {
        const newEventId = saveResult.data;
        if (typeof newEventId !== "string") {
          setError(
            "The event was saved, but its banner could not be attached. Open the event from Home and try again.",
          );
          setStatus("idle");
          return;
        }

        const { data: createdEvent, error: versionError } = await supabase
          .from("events")
          .select("updated_at")
          .eq("id", newEventId)
          .single<{ updated_at: string }>();

        if (versionError || !createdEvent) {
          console.error("Failed to load the new event version:", versionError);
          router.replace(`/events/${newEventId}/edit?banner=failed`);
          router.refresh();
          return;
        }

        try {
          await uploadEventBanner(
            newEventId,
            createdEvent.updated_at,
            pendingBanner,
          );
        } catch (bannerError) {
          console.error("Event saved but banner upload failed:", bannerError);
          router.replace(`/events/${newEventId}/edit?banner=failed`);
          router.refresh();
          return;
        }
      }

      router.replace("/home");
      router.refresh();
    } catch {
      setError("Network error, please try again.");
      setStatus("idle");
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={initialEvent ? "Edit Event" : "Create Event"}
        description={
          initialEvent
            ? "Update the event details and the tasks you are allowed to manage."
            : "Set the event details and prepare its initial task backlog."
        }
        actions={
          initialEvent ? (
            <Badge
              variant={initialEvent.status === "Draft" ? "neutral" : "outline"}
            >
              {initialEvent.status}
            </Badge>
          ) : null
        }
      />

      <MotionPresence open={Boolean(bannerNotice && showBannerNotice)}>
        {bannerNotice ? <InlineAlert className="mb-4">{bannerNotice}</InlineAlert> : null}
      </MotionPresence>

      {!initialEvent && (
        <SectionEnter>
        <Card className="mb-6 overflow-hidden border-border/70">
          <CardHeader className="border-b border-border/70 bg-gradient-to-r from-primary/10 via-muted/30 to-card pb-4 sm:pb-4">
            <CardTitle>Choose a starting point</CardTitle>
            <p className="text-sm text-muted-foreground">
              Build a fresh task list or copy the structure of an Archived
              event.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                aria-pressed={templateMode === "scratch"}
                onClick={() => selectTemplateMode("scratch")}
                className={`relative flex min-h-20 items-start gap-3 rounded-2xl border-2 p-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  templateMode === "scratch"
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/50 hover:bg-muted/30"
                }`}
              >
                {templateMode === "scratch" ? (
                  <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check aria-hidden className="size-3" />
                  </span>
                ) : null}
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileText aria-hidden className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">
                    Start from Scratch
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Create phases and tasks from a blank slate.
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-pressed={templateMode === "archive"}
                onClick={() => selectTemplateMode("archive")}
                className={`relative flex min-h-20 items-start gap-3 rounded-2xl border-2 p-4 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                  templateMode === "archive"
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card hover:border-primary/50 hover:bg-muted/30"
                }`}
              >
                {templateMode === "archive" ? (
                  <span className="absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check aria-hidden className="size-3" />
                  </span>
                ) : null}
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Archive aria-hidden className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">
                    Start from Archive Template
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Copy past tasks and shift their dates automatically.
                  </span>
                </span>
              </button>
            </div>

            {templateMode === "archive" && (
              <TabPanel
                motionKey={templateMotionKey}
                className="grid gap-3 rounded-2xl border bg-muted/30 p-4"
              >
                <div>
                  <p className="text-sm font-semibold">
                    Choose an Archived event
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Assignees are cleared, every copied task starts as To Do,
                    and confidential tasks are skipped.
                  </p>
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search Archived events"
                    type="search"
                    value={templateSearch}
                    onChange={(event) => setTemplateSearch(event.target.value)}
                    onKeyDown={preventSearchFormSubmission}
                    placeholder="Search past events…"
                    className="pl-9"
                  />
                </div>

                <div className="grid max-h-64 gap-2 overflow-y-auto">
                  {filteredArchivedTemplates.map((template) => (
                    <div
                      key={template.id}
                      className="flex items-center gap-3 rounded-xl border bg-card p-3"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                        {template.startDate.slice(0, 4)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">
                          {template.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Started {template.startDate}
                        </span>
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={templateStatus === "loading"}
                        onClick={() => requestTemplateImport(template)}
                      >
                        {templateStatus === "loading" ? (
                          <>
                            <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
                            Importing…
                          </>
                        ) : (
                          "Use"
                        )}
                      </Button>
                    </div>
                  ))}

                  {archivedTemplates.length === 0 && (
                    <div className="grid justify-items-center gap-2 rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                      <TigerLogo size={36} className="motion-empty-breathe shrink-0 opacity-70 grayscale" />
                      <p>No Archived events are available yet.</p>
                    </div>
                  )}
                  {archivedTemplates.length > 0 &&
                    filteredArchivedTemplates.length === 0 && (
                      <p className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                        No Archived events match your search.
                      </p>
                    )}
                </div>

                {templateError && <InlineAlert>{templateError}</InlineAlert>}
              </TabPanel>
            )}

            <MotionPresence open={templateSummary !== null}>
              {templateSummary ? <InlineAlert variant="info">
                <div className="grid gap-2">
                  <p>
                    {templateSummary.applied
                      ? `Imported ${templateSummary.importedTaskCount} task${templateSummary.importedTaskCount === 1 ? "" : "s"} from “${templateSummary.template.name}” into the Backlog as To Do.`
                      : `“${templateSummary.template.name}” has no importable tasks. Your current task setup was left unchanged.`}
                  </p>
                  {templateSummary.skippedConfidentialCount > 0 && (
                    <p className="font-medium">
                      {templateSummary.skippedConfidentialCount} confidential
                      task
                      {templateSummary.skippedConfidentialCount === 1
                        ? " was"
                        : "s were"}{" "}
                      not imported.
                    </p>
                  )}
                  {templateSummary.skippedUnsupportedScheduleCount > 0 && (
                    <p className="font-medium">
                      {templateSummary.skippedUnsupportedScheduleCount} task
                      {templateSummary.skippedUnsupportedScheduleCount === 1
                        ? " was"
                        : "s were"}{" "}
                      not imported because the Live Operation schedule spans
                      more than one day or has an end time without a call time.
                    </p>
                  )}
                  {importedStartDateChanged && (
                    <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p>
                        These dates were shifted for a{" "}
                        {templateSummary.importedStartDate}
                        start. Re-import to use the new {startDate || "blank"}
                        start date.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={templateStatus === "loading"}
                        onClick={() =>
                          requestTemplateImport(
                            templateSummary.template,
                            "reimport",
                          )
                        }
                      >
                        <RotateCcw />
                        Re-import with new start date
                      </Button>
                    </div>
                  )}
                </div>
              </InlineAlert> : null}
            </MotionPresence>
          </CardContent>
        </Card>
        </SectionEnter>
      )}

      <div className="grid min-w-0 gap-6 lg:items-start lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="min-w-0 overflow-hidden border-border/70">
          <div
            className="flex gap-1 overflow-x-auto border-b border-border/70 bg-gradient-to-r from-primary/10 via-muted/30 to-card px-5 pt-3 sm:px-6"
          >
            <button
              type="button"
              aria-pressed={tab === "fundamentals"}
              aria-controls="event-fundamentals-panel"
              onClick={() => selectFormTab("fundamentals")}
              className={`min-h-11 shrink-0 border-b-2 px-3 py-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                tab === "fundamentals"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Fundamentals
            </button>
            <button
              type="button"
              aria-pressed={tab === "tasks"}
              aria-controls="event-tasks-panel"
              onClick={() => selectFormTab("tasks")}
              className={`min-h-11 shrink-0 border-b-2 px-3 py-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 ${
                tab === "tasks"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Tasks {taskCount > 0 && `(${taskCount})`}
            </button>
          </div>

          <CardContent>
            {tab === "fundamentals" ? (
              <TabPanel
                motionKey={tabMotionKey}
                id="event-fundamentals-panel"
                className="grid gap-5"
              >
                <SectionEnter index={0} className="flex items-start gap-3 rounded-xl border border-border/70 bg-gradient-to-r from-primary/10 via-muted/30 to-card p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <CalendarDays aria-hidden className="size-5" />
                  </span>
                  <div>
                    <h2 className="font-display font-semibold">
                      Event fundamentals
                    </h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Set the event identity, schedule, and banner.
                    </p>
                  </div>
                </SectionEnter>
                <SectionEnter index={1} className="grid gap-2">
                  <p className="text-sm font-semibold">Event banner</p>
                  <BannerUploader
                    eventName={name}
                    eventId={initialEvent?.id}
                    currentBannerUrl={bannerUrl}
                    expectedUpdatedAt={initialEvent ? eventVersion : undefined}
                    pendingFile={pendingBanner}
                    onPendingFileChange={setPendingBanner}
                    onSaved={(nextBannerUrl, updatedAt) => {
                      setBannerUrl(nextBannerUrl);
                      setEventVersion(updatedAt);
                      setShowBannerNotice(false);
                    }}
                  />
                </SectionEnter>

                <FormField label="Event name">
                  {(control) => (
                    <Input
                      {...control}
                      required
                      maxLength={150}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="e.g. Freshmen Orientation"
                    />
                  )}
                </FormField>

                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Start date">
                    {(control) => (
                      <Input
                        {...control}
                        type="date"
                        value={startDate}
                        onChange={(event) => setStartDate(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField
                    label="End date"
                    error={
                      datesOutOfOrder
                        ? "End date must be on or after the start date."
                        : null
                    }
                  >
                    {(control) => (
                      <Input
                        {...control}
                        type="date"
                        min={startDate || undefined}
                        aria-invalid={datesOutOfOrder}
                        value={endDate}
                        onChange={(event) => setEndDate(event.target.value)}
                      />
                    )}
                  </FormField>
                </div>

                <MotionPresence open={tasksOutsideDateRange.length > 0}>
                  {tasksOutsideDateRange.length > 0 ? <InlineAlert variant="info">
                    <div className="grid gap-1">
                      <p>
                        These task due dates fall outside the new event range.
                        Saving will leave them unchanged:
                      </p>
                      <ul className="list-disc pl-5">
                        {tasksOutsideDateRange.map((task) => (
                          <li key={task.id}>
                            {task.title} — {task.dueDate}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </InlineAlert> : null}
                </MotionPresence>

                <FormField
                  label="Description"
                  action={
                    <span className="text-xs text-muted-foreground">
                      {description.length}/300
                    </span>
                  }
                >
                  {(control) => (
                    <textarea
                      {...control}
                      rows={4}
                      maxLength={300}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="What is this event, and why does it matter?"
                      className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition-[color,box-shadow,border-color] duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none dark:bg-input/30"
                    />
                  )}
                </FormField>

                <Button
                  type="button"
                  variant="link"
                  className="w-fit px-0"
                  onClick={() => selectFormTab("tasks")}
                >
                  Continue to Task Setup
                  <ChevronRight />
                </Button>
              </TabPanel>
            ) : (
              <TabPanel
                motionKey={tabMotionKey}
                id="event-tasks-panel"
                className="grid gap-5"
              >
                <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-gradient-to-r from-primary/10 via-muted/30 to-card p-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ListChecks aria-hidden className="size-5" />
                  </span>
                  <div>
                    <h2 className="font-display font-semibold">Task setup</h2>
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      Organize the work into phases and assign initial owners.
                    </p>
                  </div>
                </div>
                <InlineAlert variant="info">
                  A phase with no tasks will not be saved. Add at least one task
                  to every phase you want to keep.
                </InlineAlert>

                {role === "Co-Admin" && (
                  <p className="text-sm text-muted-foreground">
                    You can edit only your committee&apos;s tasks. Other committees&apos;
                    Draft tasks appear as read-only cards.
                  </p>
                )}

                {initialEvent?.status === "Draft" && draftReaderQuery.isError ? (
                  <InlineAlert>
                    The read-only Draft overview could not be refreshed. Phase
                    actions stay unavailable until it reloads.
                  </InlineAlert>
                ) : null}

                {phases.length === 0 && readOnlyTasksByPhase.size === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed p-8 text-center">
                    <TigerLogo size={40} className="motion-empty-breathe mx-auto shrink-0 opacity-70 grayscale" />
                    <p className="mt-3 font-semibold">No phases yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add a phase, then place its tasks into the backlog.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {phases.map((phase) => {
                      const readOnlyPhaseTasks = readOnlyTasksByPhase.get(phase.name) ?? [];
                      const phaseActionsDisabled = role === "Co-Admin" && initialEvent?.status === "Draft" &&
                        (draftReaderQuery.isPending || draftReaderQuery.isError || readOnlyPhaseTasks.length > 0);
                      return (
                      <section key={phase.id} className="overflow-hidden rounded-2xl border bg-card">
                        <div className="flex min-w-0 items-center gap-2 border-b bg-muted/40 p-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={
                              phase.collapsed
                                ? "Expand phase"
                                : "Collapse phase"
                            }
                            onClick={() => togglePhase(phase.id)}
                          >
                            <ChevronDown
                              className={cn(
                                "transition-transform duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
                                phase.collapsed && "-rotate-90",
                              )}
                            />
                          </Button>
                          <Input
                            aria-label="Phase name"
                            maxLength={100}
                            value={phase.name}
                            disabled={phaseActionsDisabled}
                            onChange={(event) =>
                              updatePhaseName(phase.id, event.target.value)
                            }
                            className="h-11 min-w-0 flex-1 border-transparent bg-transparent font-semibold shadow-none hover:border-border md:h-8"
                          />
                          <Badge variant="neutral">
                            {phase.tasks.length + readOnlyPhaseTasks.length} task
                            {phase.tasks.length + readOnlyPhaseTasks.length === 1 ? "" : "s"}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                            aria-label={`Remove ${phase.name}`}
                            disabled={phaseActionsDisabled}
                            onClick={() => requestRemovePhase(phase)}
                          >
                            <Trash2 />
                          </Button>
                        </div>

                        <Collapse open={!phase.collapsed}>
                          <div className="grid gap-3 p-3">
                            {readOnlyPhaseTasks.length > 0 ? (
                              <p className="text-sm text-muted-foreground">
                                This phase includes read-only tasks from another committee. You can move your committee&apos;s tasks, but you can&apos;t rename or remove this phase.
                              </p>
                            ) : null}
                            {phase.tasks.map((task) => {
                              const committee = committees.find(
                                (item) => item.id === task.committeeId,
                              );
                              return (
                                <div
                                  key={task.id}
                                  className={cn(
                                    "flex flex-col gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between",
                                    savedTaskId === task.id &&
                                      "motion-success-enter outline-2 outline-primary/40",
                                  )}
                                  onAnimationEnd={(event) => {
                                    if (
                                      event.target === event.currentTarget &&
                                      event.animationName ===
                                        SUCCESS_ANIMATION_NAME
                                    ) {
                                      setSavedTaskId(null);
                                    }
                                  }}
                                >
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold">
                                      {task.title}
                                    </p>
                                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                      <Badge variant="outline">
                                        {committee?.name ?? "Unknown committee"}
                                      </Badge>
                                      <span>
                                        {task.taskType === "LiveOperation"
                                          ? "Live Operation"
                                          : "Deliverable"}
                                      </span>
                                      <PriorityBadge priority={task.priority} />
                                      {task.persisted && (
                                        <TaskStatusBadge status={task.status} />
                                      )}
                                      {task.dueDate && (
                                        <span className="inline-flex items-center gap-1">
                                          <CalendarDays className="size-3" />
                                          {task.dueDate}
                                        </span>
                                      )}
                                      <span className="inline-flex items-center gap-1">
                                        <Users className="size-3" />
                                        {task.assigneeIds.length > 0
                                          ? `${task.assigneeIds.length} assigned`
                                          : "Backlog"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 gap-1">
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={`Edit ${task.title}`}
                                      onClick={() =>
                                        openEditTask(phase.id, task)
                                      }
                                    >
                                      <Pencil />
                                    </Button>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon-sm"
                                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                                      aria-label={`Remove ${task.title}`}
                                      title={
                                        task.status === "To Do"
                                          ? `Remove ${task.title}`
                                          : `${task.status} tasks cannot be deleted`
                                      }
                                      disabled={task.status !== "To Do"}
                                      onClick={() =>
                                        removeTask(phase.id, task.id)
                                      }
                                    >
                                      <Trash2 />
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}

                            {readOnlyPhaseTasks.map((task) => (
                              <div key={task.out_task_id} className="rounded-xl border bg-muted/30 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <p className="font-semibold">{task.out_title}</p>
                                  <Badge variant="neutral">Read only</Badge>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  {task.out_committee_name ? <Badge variant="outline">{task.out_committee_name}</Badge> : null}
                                  <TaskStatusBadge status={task.out_status} />
                                  {task.out_is_masked ? <span>Confidential details are hidden.</span> : null}
                                </div>
                              </div>
                            ))}

                            {phase.tasks.length === 0 && (
                              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                                This phase is empty and will not be saved.
                              </p>
                            )}

                            <Button
                              type="button"
                              variant="outline"
                              className="w-full border-dashed"
                              onClick={() => openNewTask(phase.id)}
                            >
                              <Plus />
                              Add task
                            </Button>
                          </div>
                        </Collapse>
                      </section>
                    )})}
                    {Array.from(readOnlyTasksByPhase.entries())
                      .filter(([phaseName]) => !phases.some((phase) => phase.name === phaseName))
                      .map(([phaseName, tasks]) => (
                        <section key={`readonly-${phaseName}`} className="overflow-hidden rounded-2xl border bg-card">
                          <div className="flex items-center justify-between gap-2 border-b bg-muted/40 p-3">
                            <p className="font-semibold">{phaseName}</p>
                            <Badge variant="neutral">{tasks.length} read only</Badge>
                          </div>
                          <div className="grid gap-3 p-3">
                            <p className="text-sm text-muted-foreground">This phase belongs to another committee and cannot be renamed or removed.</p>
                            {tasks.map((task) => (
                              <div key={task.out_task_id} className="rounded-xl border bg-muted/30 p-4">
                                <p className="font-semibold">{task.out_title}</p>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                                  <Badge variant="neutral">Read only</Badge>
                                  <TaskStatusBadge status={task.out_status} />
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))}
                  </div>
                )}

                <div className="flex flex-col gap-2 rounded-2xl border-2 border-dashed p-4 sm:flex-row">
                  <Input
                    aria-label="New phase name"
                    maxLength={100}
                    value={newPhaseName}
                    onChange={(event) => setNewPhaseName(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addPhase();
                      }
                    }}
                    placeholder="e.g. Event Day"
                  />
                  <Button type="button" onClick={addPhase}>
                    <Plus />
                    Add phase
                  </Button>
                </div>
              </TabPanel>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit overflow-hidden border-border/70 lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7.5rem)] lg:overflow-y-auto">
          <CardHeader className="border-b border-border/70 bg-gradient-to-r from-primary/10 via-muted/30 to-card pb-4 sm:pb-4">
            <p className="text-[11px] font-bold tracking-wide text-accent-foreground uppercase">
              Event summary
            </p>
            <CardTitle>{name.trim() || "Untitled Event"}</CardTitle>
            <p className="text-xs text-muted-foreground">
              {datesSet ? `${startDate} – ${endDate}` : "Dates not set"}
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2 border-y py-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Phases</span>
                <span className="font-semibold">{phases.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total tasks</span>
                <span className="font-semibold">{taskCount}</span>
              </div>
            </div>

            <div className="grid gap-2 text-xs text-muted-foreground">
              <SummaryCheck done={nameSet}>Event name set</SummaryCheck>
              <SummaryCheck done={datesSet && !datesOutOfOrder}>
                Valid start and end dates
              </SummaryCheck>
              <SummaryCheck done={initialEvent ? true : taskCount > 0}>
                {initialEvent
                  ? "Existing event loaded"
                  : "At least one task added"}
              </SummaryCheck>
            </div>

            {error && <InlineAlert>{error}</InlineAlert>}

            <Button
              type="button"
              variant={
                initialEvent?.status === "Active" ? "default" : "outline"
              }
              size="lg"
              className={
                initialEvent?.status === "Active" ? "order-1" : "order-2"
              }
              disabled={status === "saving"}
              onClick={() => handleSave(false)}
            >
              {status === "saving"
                ? "Saving…"
                : initialEvent
                  ? "Save Changes"
                  : "Save Draft"}
            </Button>
            {(!initialEvent || initialEvent.status === "Draft") && (
              <Button
                type="button"
                size="lg"
                className="order-1"
                disabled={status === "saving" || !readyToLaunch}
                onClick={() => handleSave(true)}
              >
                {status === "saving" ? "Saving…" : "Launch Event"}
              </Button>
            )}
            <Link
              href="/home"
              className={buttonVariants({
                variant: "outline",
                size: "lg",
                className: "order-3 w-full",
              })}
            >
              Cancel
            </Link>
            <p className="order-4 text-xs text-muted-foreground">
              {initialEvent
                ? "Every successful save advances the event version so concurrent edits cannot overwrite each other."
                : "Launch requires valid dates and at least one task. Drafts may be saved without tasks."}
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={taskDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeTaskDialog();
        }}
      >
        <DialogContent
          className={cn(
            "max-w-2xl grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:p-0",
            !taskDialogOpen && "pointer-events-none",
          )}
          aria-hidden={!taskDialogOpen || undefined}
          inert={!taskDialogOpen ? true : undefined}
          onTransitionEnd={(event) => {
            if (
              event.target === event.currentTarget &&
              event.propertyName === "opacity" &&
              !taskDialogOpen
            ) {
              setTaskEditor(null);
            }
          }}
        >
          <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-3.5 pr-12 sm:px-5 sm:py-4 sm:pr-14">
            <DialogTitle>
              {taskEditor?.taskId ? "Edit task" : "Add task"}
            </DialogTitle>
            <DialogDescription>
              Leave assignees empty to send this task to the Backlog.
            </DialogDescription>
          </DialogHeader>

          {taskEditor && (
            <div
              ref={taskDialogScrollRef}
              className="grid min-h-0 min-w-0 gap-5 overflow-y-auto px-4 py-5 sm:px-5"
            >
              <SectionEnter as="section" index={0} className="grid gap-4 border-b border-border/70 pb-5">
                <SectionHeading
                  icon={<FileText aria-hidden />}
                  title="Details"
                />
              <FormField label="Task title">
                {(control) => (
                  <Input
                    {...control}
                    data-task-field="title"
                    autoFocus
                    maxLength={200}
                    value={taskEditor.draft.title}
                    onChange={(event) =>
                      updateTaskDraft({ title: event.target.value })
                    }
                    placeholder="e.g. Coordinate sound system"
                  />
                )}
              </FormField>

              <FormField
                label="Description"
                hint="Optional · up to 2,000 characters"
              >
                {(control) => (
                  <textarea
                    {...control}
                    rows={3}
                    maxLength={2000}
                    value={taskEditor.draft.description}
                    onChange={(event) =>
                      updateTaskDraft({ description: event.target.value })
                    }
                    className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition-[color,box-shadow,border-color] duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none dark:bg-input/30"
                  />
                )}
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Type" labelTarget="group">
                  {(control) => (
                    <TaskTypeToggle
                      {...control}
                      value={taskEditor.draft.taskType}
                      onValueChange={(value) =>
                        updateTaskDraft({ taskType: value })
                      }
                    />
                  )}
                </FormField>

                <FormField label="Priority">
                  {(control) => (
                    <Select
                      items={priorityItems}
                      value={taskEditor.draft.priority}
                      onValueChange={(value) =>
                        value && updateTaskDraft({ priority: value })
                      }
                    >
                      <SelectTrigger {...control}>
                        <SelectValue className="sr-only" />
                        <PriorityBadge
                          priority={taskEditor.draft.priority}
                          aria-hidden="true"
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {priorities.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            <PriorityBadge priority={priority} />
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              </div>
              </SectionEnter>

              <SectionEnter as="section" index={1} className="grid gap-4 border-b border-border/70 pb-5">
                <SectionHeading
                  icon={<CalendarDays aria-hidden />}
                  title="When"
                />
                <FormField label="Due date" hint="Optional">
                  {(control) => (
                    <Input
                      {...control}
                      type="date"
                      value={taskEditor.draft.dueDate}
                      onChange={(event) =>
                        updateTaskDraft({ dueDate: event.target.value })
                      }
                    />
                  )}
                </FormField>

              <MotionPresence open={taskEditor.draft.taskType === "LiveOperation"}>
                {taskEditor.draft.taskType === "LiveOperation" ? <div className="grid gap-4 rounded-xl border border-primary/30 bg-primary/5 p-3.5">
                  <InlineAlert variant="info">
                    This is a live duty — don&apos;t start before Call Time, and
                    be physically ready at that moment.
                  </InlineAlert>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField label="Duty date" hint="Optional">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="call-date"
                          type="date"
                          value={taskEditor.draft.callDate}
                          onChange={(event) =>
                            updateTaskDraft({ callDate: event.target.value })
                          }
                        />
                      )}
                    </FormField>
                    <FormField label="Call time" hint="Optional">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="call-time"
                          type="time"
                          value={taskEditor.draft.callTime}
                          onChange={(event) =>
                            updateTaskDraft({ callTime: event.target.value })
                          }
                        />
                      )}
                    </FormField>
                    <FormField label="End time" hint="Optional">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="end-time"
                          type="time"
                          min={taskEditor.draft.callTime || undefined}
                          value={taskEditor.draft.endTime}
                          onChange={(event) =>
                            updateTaskDraft({ endTime: event.target.value })
                          }
                        />
                      )}
                    </FormField>
                  </div>
                </div> : null}
              </MotionPresence>
              </SectionEnter>

              <SectionEnter as="section" index={2} className="grid gap-4">
                <SectionHeading
                  icon={<Users aria-hidden />}
                  title="Who"
                />
                <FormField label="Committee">
                  {(control) => (
                    <Select
                      items={committeeItems}
                      value={taskEditor.draft.committeeId || null}
                      onValueChange={(value) =>
                        updateTaskDraft({
                          committeeId: value ?? "",
                        })
                      }
                    >
                      <SelectTrigger {...control} data-task-field="committee">
                        <SelectValue placeholder="Select a committee" />
                      </SelectTrigger>
                      <SelectContent>
                        {committeeItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>

              <fieldset className="grid min-w-0 gap-3">
                <legend className="mb-1 text-sm font-semibold">
                  Assignees
                </legend>
                {inactiveAssigneeIds.length > 0 && (
                  <div className="grid gap-2 rounded-xl border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      Previously assigned members who are now inactive can stay
                      assigned or be removed.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {inactiveAssigneeIds.map((assigneeId) => (
                        <span
                          key={assigneeId}
                          className="inline-flex items-center gap-1 rounded-full border bg-card py-1 pr-1 pl-2.5 text-xs font-medium"
                        >
                          Inactive member
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Remove inactive member"
                            onClick={() =>
                              updateTaskDraft({
                                assigneeIds:
                                  taskEditor.draft.assigneeIds.filter(
                                    (id) => id !== assigneeId,
                                  ),
                              })
                            }
                          >
                            <X />
                          </Button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search assignees"
                    type="search"
                    value={assigneeSearch}
                    onChange={(event) => setAssigneeSearch(event.target.value)}
                    onKeyDown={preventSearchFormSubmission}
                    placeholder="Search members…"
                    className="pl-9"
                  />
                </div>

                <div className="grid max-h-64 gap-3 overflow-y-auto rounded-xl border bg-card p-2">
                  {visibleAssignees.length >= 2 && (
                    <AssigneeBulkControls
                      visibleCount={visibleAssignees.length}
                      selectedVisibleCount={selectedVisibleAssigneeCount}
                      selectAllDisabled={selectAllVisibleExceedsLimit}
                      onSelectAll={(checked) =>
                        updateVisibleAssignees(checked)
                      }
                      onClear={() => updateVisibleAssignees(false)}
                    />
                  )}

                  {!selectedCommitteeHasActiveMembers && (
                    <p className="px-2 py-1 text-xs text-muted-foreground">
                      No active members in this committee. You can still assign
                      people from other committees.
                    </p>
                  )}

                  {assigneeGroups.selected.length > 0 && (
                    <AssigneeGroup
                      title={`${committeeNames.get(taskEditor.draft.committeeId) ?? "Selected committee"} members`}
                      assignees={assigneeGroups.selected}
                      selectedIds={taskEditor.draft.assigneeIds}
                      committeeNames={committeeNames}
                      onToggle={(assigneeId, checked) =>
                        updateTaskDraft({
                          assigneeIds: checked
                            ? [...taskEditor.draft.assigneeIds, assigneeId]
                            : taskEditor.draft.assigneeIds.filter(
                                (id) => id !== assigneeId,
                              ),
                        })
                      }
                    />
                  )}

                  {assigneeGroups.other.length > 0 && (
                    <AssigneeGroup
                      title="Other committees"
                      assignees={assigneeGroups.other}
                      selectedIds={taskEditor.draft.assigneeIds}
                      committeeNames={committeeNames}
                      onToggle={(assigneeId, checked) =>
                        updateTaskDraft({
                          assigneeIds: checked
                            ? [...taskEditor.draft.assigneeIds, assigneeId]
                            : taskEditor.draft.assigneeIds.filter(
                                (id) => id !== assigneeId,
                              ),
                        })
                      }
                    />
                  )}

                  {assigneeGroups.selected.length === 0 &&
                    assigneeGroups.other.length === 0 &&
                    selectedCommitteeHasActiveMembers && (
                      <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                        No members match your search.
                      </p>
                    )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {taskEditor.draft.assigneeIds.length} selected. Tasks are
                  unassigned by default and stay in the Backlog until someone
                  claims or is assigned to them.
                </p>
              </fieldset>
              </SectionEnter>
            </div>
          )}

          <div className="grid shrink-0 gap-3 border-t border-border/70 bg-popover p-4 sm:px-5">
            <MotionPresence open={Boolean(taskEditorError)}>
              {taskEditorError ? <InlineAlert>{taskEditorError}</InlineAlert> : null}
            </MotionPresence>
            <DialogFooter className="grid grid-cols-2 sm:flex">
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                onClick={closeTaskDialog}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="w-full sm:w-auto"
                onClick={saveTask}
              >
                {taskEditor?.taskId ? "Save changes" : "Add task"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingTemplateImport !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTemplateImport(null);
        }}
        title={
          pendingTemplateImport?.reason === "reimport"
            ? "Re-import this template?"
            : "Replace the current task setup?"
        }
        description={
          pendingTemplateImport?.reason === "reimport"
            ? "This replaces the current phases and tasks with a fresh copy shifted from the template to the new start date. Any task edits made after the previous import will be lost."
            : "Importing this template replaces every phase and task currently in the form. Event details are not changed."
        }
        confirmLabel={
          pendingTemplateImport?.reason === "reimport"
            ? "Re-import tasks"
            : "Replace and import"
        }
        onConfirm={() => {
          const pending = pendingTemplateImport;
          setPendingTemplateImport(null);
          if (pending) void importTemplate(pending.template);
        }}
      />

      <ConfirmDialog
        open={phaseToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPhaseToRemove(null);
        }}
        title="Remove this phase?"
        description={
          phaseToRemove?.tasks.length
            ? `This also removes ${phaseToRemove.tasks.length} task${phaseToRemove.tasks.length === 1 ? "" : "s"}. Persisted To Do tasks will be deleted when you save.`
            : "This removes the empty phase from the form."
        }
        confirmLabel="Remove phase"
        destructive
        onConfirm={() => {
          if (phaseToRemove) {
            setPhaseActions((current) => {
              const queuedRename = current.find(
                (action) =>
                  action.key === phaseToRemove.id && action.type === "rename",
              );
              return [
                ...current.filter((action) => action.key !== phaseToRemove.id),
                {
                  key: phaseToRemove.id,
                  type: "delete",
                  phase: queuedRename?.phase ?? phaseToRemove.name,
                },
              ];
            });
            const persistedIds = phaseToRemove.tasks
              .filter((task) => task.persisted)
              .map((task) => task.id);
            setDeletedTaskIds((current) => [
              ...current,
              ...persistedIds.filter((id) => !current.includes(id)),
            ]);
            setPhases((current) =>
              current.filter((phase) => phase.id !== phaseToRemove.id),
            );
          }
          setPhaseToRemove(null);
        }}
      />
    </div>
  );
}

function SectionHeading({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg]:size-3.5">
        {icon}
      </span>
      <h3 className="font-display text-sm font-semibold">{title}</h3>
    </div>
  );
}

function TaskTypeToggle({
  id,
  value,
  onValueChange,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
}: {
  id: string;
  value: TaskType;
  onValueChange: (value: TaskType) => void;
  "aria-labelledby": string;
  "aria-describedby"?: string;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      className="grid grid-cols-2 gap-2 rounded-xl focus-within:ring-3 focus-within:ring-ring/50"
    >
      {taskTypes.map((option) => {
        const selected = option.value === value;
        const optionId = `${id}-${option.value}`;

        return (
          <label
            key={option.value}
            htmlFor={optionId}
            className={`flex min-h-11 cursor-pointer items-center justify-center rounded-xl border px-3 text-center text-sm font-semibold transition-colors duration-[var(--motion-interaction-duration)] active:bg-muted motion-reduce:transition-none ${
              selected
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:bg-muted hover:text-foreground"
            }`}
          >
            <input
              id={optionId}
              type="radio"
              name={`${id}-task-type`}
              value={option.value}
              checked={selected}
              onChange={() => onValueChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        );
      })}
    </div>
  );
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const Icon =
    status === "Completed"
      ? CheckCircle2
      : status === "In Progress"
        ? Clock3
        : Circle;

  return (
    <Badge variant="neutral">
      <Icon aria-hidden />
      {status}
    </Badge>
  );
}

function SummaryCheck({
  done,
  children,
}: {
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border"
        }`}
      >
        {done ? <Check className="size-2.5" /> : null}
      </span>
      <span>{children}</span>
    </div>
  );
}

function AssigneeGroup({
  title,
  assignees,
  selectedIds,
  committeeNames,
  onToggle,
}: {
  title: string;
  assignees: AssigneeOption[];
  selectedIds: string[];
  committeeNames: Map<string, string>;
  onToggle: (assigneeId: string, checked: boolean) => void;
}) {
  return (
    <div className="grid gap-1">
      <p className="px-2 text-[11px] font-bold tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      {assignees.map((assignee) => {
        const inputId = `assignee-${assignee.id}`;
        const selected = selectedIds.includes(assignee.id);
        return (
          <label
            key={assignee.id}
            htmlFor={inputId}
            className={`motion-control-trigger flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 outline-none transition-colors duration-[var(--motion-interaction-duration)] focus-within:ring-3 focus-within:ring-ring/50 active:bg-muted motion-reduce:transition-none ${
              selected
                ? "border-primary/40 bg-primary/10 hover:bg-primary/15"
                : "border-transparent hover:bg-muted"
            }`}
          >
            <input
              id={inputId}
              type="checkbox"
              checked={selected}
              onChange={(event) => onToggle(assignee.id, event.target.checked)}
              className="motion-control-pop size-5 shrink-0 accent-primary"
            />
            <UserAvatar
              name={assignee.full_name}
              src={assignee.avatar_url}
              size="sm"
              className="size-7 text-[10px]"
            />
            <span className="grid min-w-0 flex-1 leading-tight">
              <span className="truncate text-sm font-medium">
                {assignee.full_name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {assignee.activeTaskCount} active{" "}
                {assignee.activeTaskCount === 1 ? "task" : "tasks"}
              </span>
            </span>
            <Badge
              variant="neutral"
              className="max-w-28 truncate px-2 py-0.5 text-[10px]"
            >
              {assignee.committee_id
                ? (committeeNames.get(assignee.committee_id) ??
                  "Unknown committee")
                : "No committee"}
            </Badge>
          </label>
        );
      })}
    </div>
  );
}

function AssigneeBulkControls({
  visibleCount,
  selectedVisibleCount,
  selectAllDisabled,
  onSelectAll,
  onClear,
}: {
  visibleCount: number;
  selectedVisibleCount: number;
  selectAllDisabled: boolean;
  onSelectAll: (checked: boolean) => void;
  onClear: () => void;
}) {
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allSelected = selectedVisibleCount === visibleCount;
  const partlySelected = selectedVisibleCount > 0 && !allSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = partlySelected;
    }
  }, [partlySelected]);

  return (
    <div className="grid gap-1 border-b bg-card px-2 pb-2">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <label className="motion-control-trigger flex min-h-11 min-w-0 cursor-pointer items-center gap-2 rounded-lg px-1 text-xs font-semibold transition-colors duration-[var(--motion-interaction-duration)] hover:bg-muted focus-within:ring-3 focus-within:ring-ring/50 active:bg-muted motion-reduce:transition-none has-disabled:cursor-not-allowed has-disabled:opacity-50">
          <input
            ref={selectAllRef}
            type="checkbox"
            checked={allSelected}
            aria-checked={partlySelected ? "mixed" : allSelected}
            aria-describedby={
              selectAllDisabled ? "assignee-select-all-limit" : undefined
            }
            disabled={selectAllDisabled}
            onChange={(event) => onSelectAll(event.target.checked)}
            className="motion-control-pop size-5 shrink-0 accent-primary"
          />
          <span className="truncate">Select all shown ({visibleCount})</span>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={selectedVisibleCount === 0}
          onClick={onClear}
          className="shrink-0 active:bg-muted"
        >
          Clear shown
        </Button>
      </div>
      {selectAllDisabled && (
        <p
          id="assignee-select-all-limit"
          className="text-xs text-muted-foreground"
        >
          You can select up to 100 assignees. Clear another selection before
          selecting all shown.
        </p>
      )}
    </div>
  );
}

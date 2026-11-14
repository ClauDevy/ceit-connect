"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArrowDown,
  ArrowUp,
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
import { CompletedPhaseReopenDialog } from "@/components/tasks/completed-phase-reopen-dialog";
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
import { formatDateSafe } from "@/lib/safe-date";
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
  buildEventPhaseViews,
  buildCompleteEventPhaseOrder,
  eventFormPhasesAreValid,
  getEventFormSummary,
  getEventPhaseCardKey,
  getEventPhaseControls,
  getCommitteeScopedEventAssignees,
  getInitialEventTaskCommitteeId,
  getLiveOperationScheduleProblem,
  getSavableEventPhaseName,
  normalizeEventPhaseName,
  toTaskPayload,
  updateEventAssigneeSelection,
} from "@/lib/events/form";
import {
  isTemplateTaskEditable,
  normalizeTemplateExclusionIds,
  parseArchivedTemplateTasks,
  removeTemplateDerivedTasks,
  resetImportedTemplateTaskSchedule,
  shouldUseCoAdminTemplateCreate,
} from "@/lib/events/template-import";
import { getEventSaveErrorMessage } from "@/lib/events/save-error";
import { activeEventEndDateError } from "@/lib/events/end-date";
import { preventSearchFormSubmission } from "@/lib/search";
import { SUCCESS_ANIMATION_NAME } from "@/lib/motion";
import type { Committee, Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  initializePhaseDisclosure,
  parseDraftPhaseCompletionState,
  reconcilePhaseDisclosureAfterRefresh,
  revealReopenedPhase,
  setPhaseDisclosureExpanded,
  shouldRefetchAfterPhaseCompletionError,
} from "@/lib/tasks/phase-completion";

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
  endDate: string;
  endTime: string;
  priority: Priority;
  assigneeIds: string[];
  sourceTemplateTaskId: string | null;
  templateEditable: boolean;
};

type PhaseDraft = {
  id: string;
  name: string;
  originalName: string;
  origin: "persisted" | "local" | "reader-shell";
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
  phaseComplete: boolean;
  canReopen: boolean;
  reopenUpdatedAt: string | null;
};

type PhaseAction =
  | { key: string; type: "rename"; phase: string; next_phase: string }
  | { key: string; type: "delete"; phase: string };

function parseDraftEditorTask(value: unknown): DraftEditorTask | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (!(typeof row.out_task_id === "string" &&
    typeof row.out_phase === "string" &&
    typeof row.out_title === "string" &&
    typeof row.out_is_masked === "boolean" &&
    typeof row.out_is_editable === "boolean")) return null;
  return { ...(row as Omit<DraftEditorTask, "phaseComplete" | "canReopen" | "reopenUpdatedAt">), ...parseDraftPhaseCompletionState(row) };
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
  applied: boolean;
};

type PendingTemplateImport = {
  template: ArchivedEventTemplate;
  reason: "replace" | "reimport";
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

const friendlyDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function friendlyDate(value: string) {
  return formatDateSafe(friendlyDateFormatter, value, value);
}

function makeId() {
  return crypto.randomUUID();
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
      endDate: task.endDate,
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
  const [phaseOrderChanged, setPhaseOrderChanged] = useState(false);
  const [deletedTaskIds, setDeletedTaskIds] = useState<string[]>([]);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [taskEditor, setTaskEditor] = useState<TaskEditor | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [taskEditorError, setTaskEditorError] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [phaseToRemove, setPhaseToRemove] = useState<PhaseDraft | null>(null);
  const [phaseRemovalWarnings, setPhaseRemovalWarnings] = useState<Record<string, string>>({});
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
  const [completionNotice, setCompletionNotice] = useState("");
  const [completedPhaseDisclosure, setCompletedPhaseDisclosure] = useState(
    () => initializePhaseDisclosure([], new Set()),
  );
  const queryClient = useQueryClient();
  const [templateSummary, setTemplateSummary] =
    useState<TemplateImportSummary | null>(null);
  const [pendingTemplateImport, setPendingTemplateImport] =
    useState<PendingTemplateImport | null>(null);
  const [excludedTemplateTaskIds, setExcludedTemplateTaskIds] = useState<
    string[]
  >([]);
  const taskDialogScrollRef = useRef<HTMLDivElement>(null);
  const previousCompletedDraftPhases = useRef(new Set<string>());

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
      if (!Array.isArray(data)) {
        throw new Error("The Draft overview returned an invalid response.");
      }
      const parsed = data.map(parseDraftEditorTask);
      if (parsed.some((task) => task === null)) {
        throw new Error("The Draft overview returned an invalid response.");
      }
      return parsed as DraftEditorTask[];
    },
    refetchOnWindowFocus: true,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const completedDraftPhases = useMemo(() => new Set((draftReaderQuery.data ?? []).flatMap((task) =>
    task.phaseComplete && normalizeEventPhaseName(task.out_phase) !== "Unphased"
      ? [normalizeEventPhaseName(task.out_phase)] : [])), [draftReaderQuery.data]);
  const readOnlyTasks = useMemo(
    () => (draftReaderQuery.data ?? []).filter((task) => !task.out_is_editable || task.phaseComplete),
    [draftReaderQuery.data],
  );
  const phaseViews = useMemo(
    () => buildEventPhaseViews(phases, readOnlyTasks),
    [phases, readOnlyTasks],
  );
  const completedDraftViewPhases = useMemo(() => new Set(
    phaseViews.flatMap((phaseView) => {
      const complete = completedDraftPhases.has(phaseView.name) ||
        phaseView.editablePhases.some((phase) =>
          completedDraftPhases.has(normalizeEventPhaseName(phase.originalName)));
      return complete ? [phaseView.name] : [];
    }),
  ), [completedDraftPhases, phaseViews]);
  const currentCompletedPhaseDisclosure = reconcilePhaseDisclosureAfterRefresh(
    completedPhaseDisclosure,
    phaseViews.map((phaseView) => phaseView.name),
    completedDraftViewPhases,
  );
  if (currentCompletedPhaseDisclosure !== completedPhaseDisclosure) {
    setCompletedPhaseDisclosure(currentCompletedPhaseDisclosure);
  }
  const eventFormSummary = useMemo(
    () =>
      getEventFormSummary(
        phases,
        readOnlyTasks,
        new Set(deletedTaskIds),
      ),
    [deletedTaskIds, phases, readOnlyTasks],
  );
  const taskCount = eventFormSummary.taskCount;
  const nameSet = name.trim().length > 0;
  const startSet = startDate.length > 0;
  const datesSet = startSet && endDate.length > 0;
  const datesOutOfOrder = datesSet && endDate < startDate;
  const phasesValid = eventFormPhasesAreValid(phases);
  const readyToLaunch =
    nameSet &&
    datesSet &&
    !datesOutOfOrder &&
    eventFormSummary.hasTasks &&
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
  useEffect(() => {
    const newlyComplete = [...completedDraftPhases].filter(
      (phase) => !previousCompletedDraftPhases.current.has(phase),
    );
    const discarded = phases.some((phase) =>
      newlyComplete.includes(normalizeEventPhaseName(phase.originalName)) &&
      phase.tasks.some((task) =>
        !task.persisted ||
        initialTaskPayloads.get(task.id) !== JSON.stringify(toTaskPayload(phase.name, task)),
      ),
    );
    if (discarded) {
      setCompletionNotice("Changes to this phase were discarded because it is now complete");
    }
    if (newlyComplete.length > 0) {
      setPhases((current) => current.map((phase) =>
        newlyComplete.includes(normalizeEventPhaseName(phase.originalName)) && phase.name !== phase.originalName
          ? { ...phase, name: phase.originalName }
          : phase));
      setPhaseActions((current) => current.filter((action) =>
        !newlyComplete.includes(normalizeEventPhaseName(action.phase))));
      setTaskEditor((current) => {
        if (!current) return current;
        const phase = phases.find((candidate) => candidate.id === current.phaseId);
        return phase && newlyComplete.includes(normalizeEventPhaseName(phase.originalName)) ? null : current;
      });
    }
    previousCompletedDraftPhases.current = new Set(completedDraftPhases);
  }, [completedDraftPhases, initialTaskPayloads, phases]);

  const endDateTightened = Boolean(endDate && (!initialEvent?.endDate || endDate < initialEvent.endDate));
  const tasksAfterEventEnd = endDateTightened
    ? phases.flatMap((phase) =>
        phase.tasks.flatMap((task) => {
          const fields = [
            task.dueDate > endDate ? `Due ${friendlyDate(task.dueDate)}` : null,
            task.callDate > endDate ? `Call ${friendlyDate(task.callDate)}` : null,
            task.endDate > endDate ? `Ends ${friendlyDate(task.endDate)}` : null,
          ].filter((value): value is string => Boolean(value));
          return fields.length > 0 ? [{ ...task, fields }] : [];
        }),
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
    templateSummary && startDate !== templateSummary.importedStartDate,
  );
  const callerCommitteeId =
    role === "Co-Admin" && taskCommittees.length === 1
      ? taskCommittees[0].id
      : null;

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
      selected: getCommitteeScopedEventAssignees(
        filtered,
        taskEditor.draft.committeeId,
      ).sort(byName),
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

      const parsedImport = parseArchivedTemplateTasks(data.tasks);
      if (!parsedImport || parsedImport.length !== data.imported_task_count) {
        setTemplateError("The archive template returned invalid task data.");
        return;
      }
      const importedTasks = parsedImport.map((task) => {
        const templateEditable = isTemplateTaskEditable({
          role,
          callerCommitteeId,
          taskCommitteeId: task.committeeId,
        });
        const importedTask = templateEditable
          ? resetImportedTemplateTaskSchedule(task)
          : task;
        return {
          phaseName: importedTask.phaseName,
          task: {
            id: makeId(),
            persisted: false,
            status: "To Do" as const,
            title: importedTask.title,
            description: importedTask.description,
            committeeId: importedTask.committeeId,
            taskType: importedTask.taskType,
            dueDate: importedTask.dueDate,
            callDate: importedTask.callDate,
            callTime: importedTask.callTime,
            endDate: importedTask.endDate,
            endTime: importedTask.endTime,
            priority: importedTask.priority,
            assigneeIds: [],
            sourceTemplateTaskId: importedTask.sourceTaskId,
            templateEditable,
          } satisfies TaskDraft,
        };
      });

      const summary: TemplateImportSummary = {
        template: {
          ...template,
          name: data.template_name,
          startDate: data.template_start_date,
        },
        importedStartDate: startDate,
        importedTaskCount: importedTasks.length,
        skippedConfidentialCount: data.skipped_confidential_count,
        applied: importedTasks.length > 0,
      };

      setExcludedTemplateTaskIds([]);

      if (importedTasks.length === 0) {
        setPhases((current) => removeTemplateDerivedTasks(current));
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
          originalName: phaseName,
          origin: "local" as const,
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
      {
        id: makeId(),
        name: phaseName,
        originalName: phaseName,
        origin: "local",
        collapsed: false,
        tasks: [],
      },
    ]);
    setNewPhaseName("");
    setError("");
  }

  function updatePhaseName(phaseId: string, phaseName: string) {
    const currentPhase = phases.find((phase) => phase.id === phaseId);
    const currentPhaseHasReaderRows = readOnlyTasks.some(
      (task) =>
        normalizeEventPhaseName(task.out_phase) ===
        normalizeEventPhaseName(currentPhase?.name),
    );
    if (currentPhase?.origin === "reader-shell" && currentPhaseHasReaderRows) {
      return;
    }
    if (
      currentPhase?.origin === "persisted" &&
      currentPhase.name !== phaseName
    ) {
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
        phase.id === phaseId
          ? {
              ...phase,
              name: phaseName,
              origin:
                phase.origin === "reader-shell" ? "local" : phase.origin,
            }
          : phase,
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

  function movePhase(phaseId: string, direction: -1 | 1) {
    setPhases((current) => {
      const index = current.findIndex((phase) => phase.id === phaseId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= current.length) return current;
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
    setPhaseOrderChanged(true);
    setPhaseRemovalWarnings((current) => {
      const next = { ...current };
      delete next[phaseId];
      return next;
    });
  }

  function openNewTask(phaseId: string | null, phaseName?: string) {
    if (taskCount >= 200) {
      setError("An event can contain at most 200 tasks.");
      return;
    }
    if (role === "Co-Admin" && taskCommittees.length !== 1) {
      setError(
        "Add task is unavailable because your committee could not be verified.",
      );
      return;
    }

    const targetPhaseId = phaseId ?? makeId();
    if (!phaseId) {
      setPhases((current) => [
        ...current,
        {
          id: targetPhaseId,
          name: normalizeEventPhaseName(phaseName),
          originalName: normalizeEventPhaseName(phaseName),
          origin: "reader-shell",
          collapsed: false,
          tasks: [],
        },
      ]);
    }

    setTaskEditorError("");
    setAssigneeSearch("");
    setTaskEditor({
      phaseId: targetPhaseId,
      taskId: null,
      draft: {
        title: "",
        description: "",
        committeeId: getInitialEventTaskCommitteeId(role, taskCommittees),
        taskType: "Deliverable",
        dueDate: "",
        callDate: "",
        callTime: "",
        endDate: "",
        endTime: "",
        priority: "Medium",
        assigneeIds: [],
        sourceTemplateTaskId: null,
        templateEditable: true,
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
        endDate: task.endDate,
        endTime: task.endTime,
        priority: task.priority,
        assigneeIds: task.assigneeIds,
        sourceTemplateTaskId: task.sourceTemplateTaskId,
        templateEditable: task.templateEditable,
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

  function updateSingleAssignee(assigneeId: string, checked: boolean) {
    if (!taskEditor) return;
    const selection = updateEventAssigneeSelection(
      taskEditor.draft.assigneeIds,
      assigneeId,
      checked,
    );
    if (selection.error) {
      setTaskEditorError(selection.error);
      return;
    }
    setTaskEditorError("");
    updateTaskDraft({ assigneeIds: selection.ids });
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
    const scheduleProblem = getLiveOperationScheduleProblem(taskEditor.draft);
    if (scheduleProblem) {
      revealTaskProblem(scheduleProblem.field, scheduleProblem.message);
      return;
    }
    const originalTask = taskEditor.taskId
      ? phases
          .find((phase) => phase.id === taskEditor.phaseId)
          ?.tasks.find((task) => task.id === taskEditor.taskId)
      : null;
    const scheduleAfterEnd = endDate
      ? [
          taskEditor.draft.dueDate > endDate &&
          (!originalTask || taskEditor.draft.dueDate !== originalTask.dueDate)
            ? "due date"
            : null,
          taskEditor.draft.callDate > endDate &&
          (!originalTask || taskEditor.draft.callDate !== originalTask.callDate || taskEditor.draft.callTime !== originalTask.callTime)
            ? "call date"
            : null,
          taskEditor.draft.endDate > endDate &&
          (!originalTask || taskEditor.draft.endDate !== originalTask.endDate || taskEditor.draft.endTime !== originalTask.endTime)
            ? "end date"
            : null,
        ].filter((field): field is string => Boolean(field))
      : [];
    if (scheduleAfterEnd.length > 0) {
      revealTaskProblem(
        scheduleAfterEnd[0] === "due date" ? "due-date" : scheduleAfterEnd[0] === "call date" ? "call-date" : "end-date",
        `The task ${scheduleAfterEnd.join(" and ")} cannot be after the event end date (${endDate}).`,
      );
      return;
    }

    const existingTask = originalTask;
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
    if (task.sourceTemplateTaskId && !task.templateEditable) {
      setExcludedTemplateTaskIds((current) =>
        current.includes(task.sourceTemplateTaskId!)
          ? current
          : [...current, task.sourceTemplateTaskId!],
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
    const progressedTasks = phase.tasks.filter((task) => task.status !== "To Do");
    if (progressedTasks.length > 0) {
      const completedCount = progressedTasks.filter((task) => task.status === "Completed").length;
      const names = progressedTasks.slice(0, 3).map((task) => task.title).join(", ");
      const more = progressedTasks.length > 3 ? `, and ${progressedTasks.length - 3} more` : "";
      const summary = completedCount === progressedTasks.length
        ? `${completedCount} completed task${completedCount === 1 ? "" : "s"}`
        : `${progressedTasks.length} progressed tasks (${completedCount} completed)`;
      setPhaseRemovalWarnings((current) => ({
        ...current,
        [phase.id]: `This phase cannot be removed because it contains ${summary}: ${names}${more}.`,
      }));
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
    const endDateError = activeEventEndDateError({
      initialStatus: initialEvent?.status,
      initialEndDate: initialEvent?.endDate,
      nextEndDate: endDate,
    });
    if (endDateError) {
      setError(endDateError);
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
    if (launch && !eventFormSummary.hasTasks) {
      setError("Add at least one task before launching.");
      setTab("tasks");
      return;
    }
    if (!phasesValid) {
      setError("Every phase containing tasks needs a name.");
      setTab("tasks");
      return;
    }
    if (importedStartDateChanged) {
      setError("Re-import the template after changing the event start date.");
      setTab("fundamentals");
      return;
    }
    if (tasksAfterEventEnd.length > 0) {
      setError("Move the listed task schedules on or before the new event end date before saving.");
      setTab("fundamentals");
      return;
    }

    const normalizedExclusions = normalizeTemplateExclusionIds(
      excludedTemplateTaskIds,
    );
    if (!normalizedExclusions) {
      setError("The template task selection is invalid.");
      setTab("tasks");
      return;
    }

    setStatus("saving");
    setError("");

    const tasks = phases.flatMap((phase) =>
      completedDraftPhases.has(normalizeEventPhaseName(phase.name)) ||
      completedDraftPhases.has(normalizeEventPhaseName(phase.originalName))
        ? []
        : phase.tasks.map((task) => ({
            task,
            payload: toTaskPayload(getSavableEventPhaseName(phase), task),
          })),
    );

    try {
      const supabase = createClient();
      const targetStatus = launch
        ? "Active"
        : (initialEvent?.status ?? "Draft");
      const coAdminTemplateSummary = shouldUseCoAdminTemplateCreate({
        hasInitialEvent: Boolean(initialEvent),
        role,
        hasTemplateSummary: templateSummary !== null,
      })
        ? templateSummary
        : null;
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
            p_task_ids_to_delete: deletedTaskIds.filter((id) =>
              !(draftReaderQuery.data ?? []).some((task) =>
                task.out_task_id === id && task.phaseComplete)),
            p_phase_actions: [
              ...phaseActions.filter((action) =>
                !completedDraftPhases.has(normalizeEventPhaseName(action.phase)) &&
                (action.type !== "rename" || action.next_phase.trim().length > 0))
                .map((action) => action.type === "rename"
                  ? { type: action.type, phase: action.phase, next_phase: action.next_phase }
                  : { type: action.type, phase: action.phase }),
              {
                type: "reorder",
                phases: buildCompleteEventPhaseOrder({
                  serverOrder: initialEvent.phaseOrder,
                  visibleOrder: phaseViews
                  .filter((view) => view.editablePhases.some((phase) => phase.tasks.length > 0) || view.readOnlyTasks.length > 0)
                  .map((view) => {
                    const editable = view.editablePhases[0];
                    return editable ? getSavableEventPhaseName(editable) : view.name;
                  }),
                  phaseActions,
                  applyVisibleOrder: phaseOrderChanged,
                }),
              },
            ],
          })
        : coAdminTemplateSummary
          ? await supabase.rpc("create_event_from_archived_template", {
              p_name: name.trim(),
              p_description: description.trim() || null,
              p_start_date: startDate,
              p_end_date: endDate || null,
              p_status: targetStatus,
              p_template_event_id: coAdminTemplateSummary.template.id,
              p_own_tasks: tasks
                .filter(({ task }) => task.templateEditable)
                .map(({ payload }) => payload),
              p_excluded_template_task_ids: normalizedExclusions,
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
        if (shouldRefetchAfterPhaseCompletionError(saveError)) {
          try { await draftReaderQuery.refetch(); } catch { /* fixed message still appears */ }
        }
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

      router.replace(launch ? "/home?launched=1" : "/home");
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
        <Card className="mb-6 overflow-hidden">
          <CardHeader className="border-b bg-gradient-to-r from-primary/10 via-muted/30 to-card pb-4 sm:pb-4">
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
                      : `“${templateSummary.template.name}” has no importable tasks. Non-template tasks were left unchanged.`}
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
        <Card className="min-w-0 overflow-clip">
          <div
            className="flex gap-1 overflow-x-auto border-b bg-gradient-to-r from-primary/10 via-muted/30 to-card px-5 pt-3 sm:px-6"
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
                <SectionEnter index={0} className="flex items-start gap-3 rounded-xl border bg-gradient-to-r from-primary/10 via-muted/30 to-card p-4">
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
                    label={
                      initialEvent?.status === "Active"
                        ? "End date (required for Active events)"
                        : "End date"
                    }
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
                        required={
                          initialEvent?.status === "Active" &&
                          Boolean(initialEvent.endDate)
                        }
                      />
                    )}
                  </FormField>
                  {initialEvent?.status === "Active" && !initialEvent.endDate ? (
                    <p className="text-xs text-muted-foreground sm:col-start-2">
                      This legacy Active event can still be saved without an end
                      date, or you can add one now.
                    </p>
                  ) : null}
                </div>

                <MotionPresence open={tasksAfterEventEnd.length > 0}>
                  {tasksAfterEventEnd.length > 0 ? <InlineAlert>
                    <div className="grid gap-1">
                      <p>
                        The event cannot end on {friendlyDate(endDate)} because
                        these tasks are scheduled later:
                      </p>
                      <ul className="list-disc pl-5">
                        {tasksAfterEventEnd.map((task) => (
                          <li key={task.id}>
                            {task.title} — {task.fields.join(", ")}
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

                <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 -mx-1 bg-card/95 px-1 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
                  <Button
                    type="button"
                    className="w-full md:w-fit"
                    onClick={() => selectFormTab("tasks")}
                  >
                    Continue to Task Setup
                    <ChevronRight />
                  </Button>
                </div>
              </TabPanel>
            ) : (
              <TabPanel
                motionKey={tabMotionKey}
                id="event-tasks-panel"
                className="grid gap-5"
              >
                <div className="flex items-start gap-3 rounded-xl border bg-gradient-to-r from-primary/10 via-muted/30 to-card p-4">
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
                {completionNotice ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    {completionNotice}
                  </p>
                ) : null}

                {phaseViews.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed p-8 text-center">
                    <TigerLogo size={40} className="motion-empty-breathe mx-auto shrink-0 opacity-70 grayscale" />
                    <p className="mt-3 font-semibold">No phases yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add a phase, then place its tasks into the backlog.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {phaseViews.map((phaseView, phaseIndex) => {
                      const phaseComplete = completedDraftViewPhases.has(phaseView.name);
                      const editablePhase = phaseView.editablePhases[0] ?? null;
                      const editableTasks = phaseComplete ? [] : phaseView.editablePhases.flatMap(
                        (phase) =>
                          phase.tasks.map((task) => ({ phase, task })),
                      );
                      const phaseControls = getEventPhaseControls({
                        role,
                        isDraft: initialEvent?.status === "Draft",
                        readerAvailable:
                          !draftReaderQuery.isPending &&
                          !draftReaderQuery.isError,
                        hasExactlyOneTaskCommittee:
                          taskCommittees.length === 1,
                        phase: phaseView,
                        readOnlyTasks,
                      });
                      const phaseCollapsed = phaseComplete
                        ? currentCompletedPhaseDisclosure.collapsedPhases.has(phaseView.name)
                        : (editablePhase?.collapsed ?? false);
                      const phaseContentId = `draft-phase-content-${phaseIndex}`;
                      const reopenCandidates = phaseView.readOnlyTasks.flatMap((task) =>
                        task.phaseComplete && task.canReopen && task.reopenUpdatedAt
                          ? [{ id: task.out_task_id, title: task.out_title, phase: phaseView.name, updatedAt: task.reopenUpdatedAt }]
                          : []);
                      return (
                      <section key={getEventPhaseCardKey(phaseView)} className="overflow-hidden rounded-2xl border bg-card">
                        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-muted/40 p-3 sm:flex-nowrap">
                          {editablePhase || phaseComplete ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={
                                phaseCollapsed
                                  ? "Expand phase"
                                  : "Collapse phase"
                              }
                              aria-expanded={!phaseCollapsed}
                              aria-controls={phaseContentId}
                              onClick={() => phaseComplete
                                ? setCompletedPhaseDisclosure((current) =>
                                    setPhaseDisclosureExpanded(
                                      reconcilePhaseDisclosureAfterRefresh(
                                        current,
                                        phaseViews.map((view) => view.name),
                                        completedDraftViewPhases,
                                      ),
                                      phaseView.name,
                                      phaseCollapsed,
                                    ))
                                : togglePhase(editablePhase!.id)}
                            >
                              <ChevronDown
                                className={cn(
                                  "transition-transform duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
                                  phaseCollapsed && "-rotate-90",
                                )}
                              />
                            </Button>
                          ) : null}
                          {editablePhase && !phaseComplete ? (
                            <Input
                              aria-label="Phase name"
                              placeholder="Phase name (tap to rename)"
                              maxLength={100}
                              value={editablePhase.name}
                              disabled={!phaseControls.canRename}
                              onChange={(event) =>
                                updatePhaseName(
                                  editablePhase.id,
                                  event.target.value,
                                )
                              }
                              className="order-first h-12 min-w-0 basis-full border-input bg-background px-3.5 text-base font-semibold shadow-none sm:order-none sm:h-11 sm:basis-0 sm:flex-1 md:h-8"
                            />
                          ) : (
                            <p className={cn("min-w-0 flex-1 truncate font-semibold", phaseComplete && "line-through")}>
                              {phaseComplete ? <CheckCircle2 className="mr-1 inline size-4" aria-hidden /> : null}{phaseView.name}
                              {phaseComplete ? <span className="sr-only"> complete</span> : null}
                            </p>
                          )}
                          <Badge variant="neutral">
                            {editableTasks.length + phaseView.readOnlyTasks.length} task
                            {editableTasks.length + phaseView.readOnlyTasks.length === 1 ? "" : "s"}
                          </Badge>
                          {editablePhase ? (
                            <>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Move ${phaseView.name} up`}
                                className={phaseIndex === 0 ? "invisible" : undefined}
                                tabIndex={phaseIndex === 0 ? -1 : undefined}
                                onClick={() => movePhase(editablePhase.id, -1)}
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Move ${phaseView.name} down`}
                                className={phaseIndex === phaseViews.length - 1 ? "invisible" : undefined}
                                tabIndex={phaseIndex === phaseViews.length - 1 ? -1 : undefined}
                                onClick={() => movePhase(editablePhase.id, 1)}
                              >
                                <ArrowDown />
                              </Button>
                            </>
                          ) : null}
                          {phaseComplete ? (
                            <CompletedPhaseReopenDialog
                              phase={phaseView.name}
                              candidates={reopenCandidates}
                              onRefresh={async () => {
                                await draftReaderQuery.refetch();
                                await queryClient.refetchQueries({
                                  predicate: ({ queryKey }) => ["event-board", "task-detail", "task-edit-controls", "task-work-links", "task-comments", "task-backup-state"].includes(String(queryKey[0])),
                                  type: "active",
                                });
                                window.dispatchEvent(new Event("task-leave-requests:changed"));
                              }}
                              onReopened={() => setCompletedPhaseDisclosure((current) =>
                                revealReopenedPhase(current, phaseView.name))}
                            />
                          ) : editablePhase ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                              aria-label={`Remove ${phaseView.name}`}
                              disabled={!phaseControls.canRemove}
                              onClick={() => requestRemovePhase(editablePhase)}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </div>

                        <Collapse open={!phaseCollapsed}>
                          <div id={phaseContentId} className="grid gap-3 p-3">
                            {editablePhase && phaseRemovalWarnings[editablePhase.id] ? (
                              <InlineAlert>
                                {phaseRemovalWarnings[editablePhase.id]}
                              </InlineAlert>
                            ) : null}
                            {phaseView.readOnlyTasks.length > 0 && !phaseComplete ? (
                              <p className="text-sm text-muted-foreground">
                                This phase includes read-only tasks from another committee. You can add tasks for your committee, but you can&apos;t rename or remove this phase.
                              </p>
                            ) : null}
                            {editableTasks.map(({ phase, task }) => {
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
                                      {!task.templateEditable && (
                                        <Badge variant="neutral">Read only</Badge>
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
                                          : "Unassigned (Backlog)"}
                                      </span>
                                    </div>
                                  </div>
                                  <div className="flex shrink-0 gap-1">
                                    {task.templateEditable ? (
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
                                    ) : null}
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

                            {phaseView.readOnlyTasks.map((task) => (
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

                            {editableTasks.length === 0 && phaseView.readOnlyTasks.length === 0 && (
                              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                                This phase is empty and will not be saved.
                              </p>
                            )}

                            {!phaseComplete && !phaseControls.canAddTask && role === "Co-Admin" ? (
                              <p className="text-sm text-muted-foreground">
                                Add task is unavailable because your committee could not be verified.
                              </p>
                            ) : null}

                            {!phaseComplete ? <Button
                              type="button"
                              variant="outline"
                              className="w-full border-dashed"
                              disabled={!phaseControls.canAddTask}
                              onClick={() =>
                                openNewTask(
                                  editablePhase?.id ?? null,
                                  phaseView.name,
                                )
                              }
                            >
                              <Plus />
                              Add task
                            </Button> : null}
                          </div>
                        </Collapse>
                      </section>
                    )})}
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

        <Card className="h-fit overflow-hidden lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7.5rem)] lg:overflow-y-auto">
          <CardHeader className="border-b bg-gradient-to-r from-primary/10 via-muted/30 to-card pb-4 sm:pb-4">
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
                <span className="font-semibold">
                  {eventFormSummary.phaseCount}
                </span>
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
              <SummaryCheck done={eventFormSummary.hasTasks}>
                At least one task added
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
            {initialEvent ? null : (
              <p className="order-4 text-xs text-muted-foreground">
                Launch requires valid dates and at least one task. Drafts may be saved without tasks.
              </p>
            )}
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
          <DialogHeader className="shrink-0 border-b px-4 py-3.5 pr-12 sm:px-5 sm:py-4 sm:pr-14">
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
              <SectionEnter as="section" index={0} className="grid gap-4 border-b pb-5">
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

              <SectionEnter as="section" index={1} className="grid gap-4 border-b pb-5">
                <SectionHeading
                  icon={<CalendarDays aria-hidden />}
                  title="When"
                />
                <FormField label="Due date" hint="Optional">
                  {(control) => (
                    <Input
                      {...control}
                      data-task-field="due-date"
                      type="date"
                      max={endDate || undefined}
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
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <FormField label="Duty date" hint="Optional">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="call-date"
                          type="date"
                          max={endDate || undefined}
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
                    <FormField label="End date" hint="Optional">
                      {(control) => (
                        <Input
                          {...control}
                          data-task-field="end-date"
                          type="date"
                          min={taskEditor.draft.callDate || undefined}
                          max={endDate || undefined}
                          value={taskEditor.draft.endDate}
                          onChange={(event) =>
                            updateTaskDraft({ endDate: event.target.value })
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
                          min={
                            !taskEditor.draft.endDate ||
                            taskEditor.draft.endDate === taskEditor.draft.callDate
                              ? taskEditor.draft.callTime || undefined
                              : undefined
                          }
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
                  {(control) =>
                    role === "Co-Admin" ? (
                      <Input
                        {...control}
                        readOnly
                        data-task-field="committee"
                        value={
                          taskCommittees.length === 1
                          ? taskCommittees[0].name
                          : "Committee unavailable"
                        }
                        className="bg-muted/40"
                      />
                    ) : (
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
                    )
                  }
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
                      committeeName={committeeNames.get(taskEditor.draft.committeeId) ?? "selected committee"}
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
                        updateSingleAssignee(assigneeId, checked)
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
                        updateSingleAssignee(assigneeId, checked)
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

          <div className="grid shrink-0 gap-3 border-t bg-popover p-4 sm:px-5">
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
            ? `This also removes ${phaseToRemove.tasks.length} task${phaseToRemove.tasks.length === 1 ? "" : "s"}. Tasks can’t be moved between phases here; persisted To Do tasks will be deleted when you save.`
            : "This removes the empty phase from the form."
        }
        confirmLabel="Remove phase"
        destructive
        onConfirm={() => {
          if (phaseToRemove) {
            if (phaseToRemove.origin === "persisted") {
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
            }
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
  committeeName,
  visibleCount,
  selectedVisibleCount,
  selectAllDisabled,
  onSelectAll,
  onClear,
}: {
  committeeName: string;
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
          <span className="truncate">Select all shown in {committeeName} ({visibleCount})</span>
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { EventFormConfirmations } from "@/components/events/event-form-confirmations";
import { EventFormFundamentals } from "@/components/events/event-form-fundamentals";
import {
  friendlyDate,
  makeId,
  makeInitialPhases,
  parseDraftEditorTask,
} from "@/components/events/event-form-helpers";
import { EventFormSummary } from "@/components/events/event-form-summary";
import { EventFormTaskDialog } from "@/components/events/event-form-task-dialog";
import { EventFormTaskPhases } from "@/components/events/event-form-task-phases";
import { EventFormTemplatePicker } from "@/components/events/event-form-template-picker";
import type {
  AssigneeOption,
  ArchivedEventTemplate,
  DraftEditorTask,
  EventFormProps,
  PendingTemplateImport,
  PhaseAction,
  PhaseDraft,
  TaskDraft,
  TaskEditor,
  TemplateImportResult,
  TemplateImportSummary,
} from "@/components/events/event-form-types";
import { MotionPresence } from "@/components/shared/motion";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import { createClient } from "@/lib/supabase/client";
import { uploadEventBanner } from "@/lib/event-banner";
import {
  buildEventPhaseViews,
  buildCompleteEventPhaseOrder,
  eventFormPhasesAreValid,
  getEventFormSummary,
  getCommitteeScopedEventAssignees,
  getEventTaskDueDateForSubmission,
  getEventTaskEndDateInputValue,
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
import {
  initializePhaseDisclosure,
  reconcilePhaseDisclosureAfterRefresh,
  revealReopenedPhase,
  setPhaseDisclosureExpanded,
  shouldRefetchAfterPhaseCompletionError,
} from "@/lib/tasks/phase-completion";

export type {
  ArchivedEventTemplate,
  InitialEvent,
  InitialEventTask,
} from "@/components/events/event-form-types";

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
  const [taskEditorErrorField, setTaskEditorErrorField] = useState<string | null>(null);
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

  const initialTasksById = useMemo(
    () => new Map((initialEvent?.tasks ?? []).map((task) => [task.id, task])),
    [initialEvent],
  );
  const initialTaskPayloads = useMemo(
    () =>
      new Map(
        (initialEvent?.tasks ?? []).map((task) => [
          task.id,
          JSON.stringify(toTaskPayload(task.phase, task, task.dueDate)),
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
        initialTaskPayloads.get(task.id) !== JSON.stringify(toTaskPayload(
          phase.name,
          task,
          initialTasksById.get(task.id)?.dueDate ?? null,
        )),
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
  }, [completedDraftPhases, initialTaskPayloads, initialTasksById, phases]);

  const endDateTightened = Boolean(endDate && (!initialEvent?.endDate || endDate < initialEvent.endDate));
  const tasksAfterEventEnd = endDateTightened
    ? phases.flatMap((phase) =>
        phase.tasks.flatMap((task) => {
          const submittedDueDate = getEventTaskDueDateForSubmission(
            task,
            initialTasksById.get(task.id)?.dueDate ?? null,
          );
          const fields = [
            submittedDueDate > endDate ? `Due ${friendlyDate(submittedDueDate)}` : null,
            task.taskType === "LiveOperation" && task.callDate > endDate ? `Call ${friendlyDate(task.callDate)}` : null,
            task.taskType === "LiveOperation" && task.endDate > endDate ? `Ends ${friendlyDate(task.endDate)}` : null,
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
  const editedTaskStatus = taskEditor?.taskId
    ? phases
        .find((phase) => phase.id === taskEditor.phaseId)
        ?.tasks.find((task) => task.id === taskEditor.taskId)?.status ?? null
    : null;

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
    setTaskEditorErrorField(null);
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
    setTaskEditorErrorField(null);
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
        endDate: getEventTaskEndDateInputValue({
          callDate: task.callDate,
          endDate: task.endDate,
          endTime: task.endTime,
        }),
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
    setTaskEditorErrorField(null);
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
      setTaskEditorErrorField(field);
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
      revealTaskProblem("title", "Enter a task title up to 200 characters.");
      return;
    }
    if (!taskEditor.draft.committeeId) {
      revealTaskProblem("committee", "Choose an available committee.");
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
    const submittedDueDate = getEventTaskDueDateForSubmission(
      taskEditor.draft,
      originalTask?.dueDate ?? null,
    );
    const scheduleAfterEnd = endDate
      ? [
          submittedDueDate > endDate &&
          (!originalTask || submittedDueDate !== originalTask.dueDate)
            ? "due date"
            : null,
          taskEditor.draft.taskType === "LiveOperation" &&
          taskEditor.draft.callDate > endDate &&
          (!originalTask || taskEditor.draft.callDate !== originalTask.callDate || taskEditor.draft.callTime !== originalTask.callTime)
            ? "call date"
            : null,
          taskEditor.draft.taskType === "LiveOperation" &&
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
    setTaskEditorErrorField(null);
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
            payload: toTaskPayload(
              getSavableEventPhaseName(phase),
              task,
              initialTasksById.get(task.id)?.dueDate ?? null,
            ),
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
        <EventFormTemplatePicker
          templateMode={templateMode}
          templateMotionKey={templateMotionKey}
          templateSearch={templateSearch}
          templateStatus={templateStatus}
          templateError={templateError}
          templateSummary={templateSummary}
          archivedTemplates={archivedTemplates}
          filteredArchivedTemplates={filteredArchivedTemplates}
          importedStartDateChanged={importedStartDateChanged}
          startDate={startDate}
          onSelectMode={selectTemplateMode}
          onSearchChange={setTemplateSearch}
          onRequestImport={requestTemplateImport}
        />
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
              <EventFormFundamentals
                tabMotionKey={tabMotionKey}
                initialEvent={initialEvent}
                name={name}
                bannerUrl={bannerUrl}
                eventVersion={eventVersion}
                pendingBanner={pendingBanner}
                startDate={startDate}
                endDate={endDate}
                datesOutOfOrder={datesOutOfOrder}
                tasksAfterEventEnd={tasksAfterEventEnd}
                description={description}
                onPendingBannerChange={setPendingBanner}
                onBannerSaved={(nextBannerUrl, updatedAt) => {
                  setBannerUrl(nextBannerUrl);
                  setEventVersion(updatedAt);
                  setShowBannerNotice(false);
                }}
                onNameChange={setName}
                onStartDateChange={setStartDate}
                onEndDateChange={setEndDate}
                onDescriptionChange={setDescription}
                onContinue={() => selectFormTab("tasks")}
              />
            ) : (
              <EventFormTaskPhases
                tabMotionKey={tabMotionKey}
                role={role}
                initialEvent={initialEvent}
                draftReaderPending={draftReaderQuery.isPending}
                draftReaderError={draftReaderQuery.isError}
                completionNotice={completionNotice}
                phaseViews={phaseViews}
                completedDraftViewPhases={completedDraftViewPhases}
                currentCompletedPhaseDisclosure={currentCompletedPhaseDisclosure}
                taskCommittees={taskCommittees}
                readOnlyTasks={readOnlyTasks}
                committees={committees}
                phaseRemovalWarnings={phaseRemovalWarnings}
                savedTaskId={savedTaskId}
                newPhaseName={newPhaseName}
                onToggleCompletedPhase={(phaseName, phaseCollapsed) =>
                  setCompletedPhaseDisclosure((current) =>
                    setPhaseDisclosureExpanded(
                      reconcilePhaseDisclosureAfterRefresh(
                        current,
                        phaseViews.map((view) => view.name),
                        completedDraftViewPhases,
                      ),
                      phaseName,
                      phaseCollapsed,
                    ))}
                onTogglePhase={togglePhase}
                onUpdatePhaseName={updatePhaseName}
                onMovePhase={movePhase}
                onRefreshCompletedPhase={async () => {
                  await draftReaderQuery.refetch();
                  await queryClient.refetchQueries({
                    predicate: ({ queryKey }) => ["event-board", "task-detail", "task-edit-controls", "task-work-links", "task-comments", "task-backup-state"].includes(String(queryKey[0])),
                    type: "active",
                  });
                  window.dispatchEvent(new Event("task-leave-requests:changed"));
                }}
                onReopenedPhase={(phaseName) =>
                  setCompletedPhaseDisclosure((current) =>
                    revealReopenedPhase(current, phaseName))}
                onRequestRemovePhase={requestRemovePhase}
                onSavedTaskAnimationEnd={() => setSavedTaskId(null)}
                onOpenEditTask={openEditTask}
                removeTask={removeTask}
                onOpenNewTask={openNewTask}
                onNewPhaseNameChange={setNewPhaseName}
                onAddPhase={addPhase}
              />
            )}
          </CardContent>
        </Card>

        <EventFormSummary
          initialEvent={initialEvent}
          name={name}
          datesSet={datesSet}
          datesOutOfOrder={datesOutOfOrder}
          startDate={startDate}
          endDate={endDate}
          phaseCount={eventFormSummary.phaseCount}
          taskCount={taskCount}
          nameSet={nameSet}
          hasTasks={eventFormSummary.hasTasks}
          error={error}
          status={status}
          readyToLaunch={readyToLaunch}
          onSave={handleSave}
        />
      </div>

      <EventFormTaskDialog
        open={taskDialogOpen}
        taskEditor={taskEditor}
        taskDialogScrollRef={taskDialogScrollRef}
        endDate={endDate}
        role={role}
        taskCommittees={taskCommittees}
        committeeItems={committeeItems}
        taskEditorError={taskEditorError}
        taskEditorErrorField={taskEditorErrorField}
        editedTaskStatus={editedTaskStatus}
        inactiveAssigneeIds={inactiveAssigneeIds}
        assigneeSearch={assigneeSearch}
        visibleAssignees={visibleAssignees}
        selectedVisibleAssigneeCount={selectedVisibleAssigneeCount}
        selectAllVisibleExceedsLimit={selectAllVisibleExceedsLimit}
        selectedCommitteeHasActiveMembers={selectedCommitteeHasActiveMembers}
        assigneeGroups={assigneeGroups}
        committeeNames={committeeNames}
        onClose={closeTaskDialog}
        onClosed={() => setTaskEditor(null)}
        updateTaskDraft={updateTaskDraft}
        onSearchChange={setAssigneeSearch}
        onUpdateVisibleAssignees={updateVisibleAssignees}
        onUpdateSingleAssignee={updateSingleAssignee}
        onSaveTask={saveTask}
      />

      <EventFormConfirmations
        pendingTemplateImport={pendingTemplateImport}
        phaseToRemove={phaseToRemove}
        setPendingTemplateImport={setPendingTemplateImport}
        setPhaseToRemove={setPhaseToRemove}
        setPhaseActions={setPhaseActions}
        setDeletedTaskIds={setDeletedTaskIds}
        setPhases={setPhases}
        importTemplate={importTemplate}
      />
    </div>
  );
}

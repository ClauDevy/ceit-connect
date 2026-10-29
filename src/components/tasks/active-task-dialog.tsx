"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CalendarDays, FileText, LoaderCircle, Search, Users } from "lucide-react";
import { MotionPresence, SectionEnter } from "@/components/shared/motion";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Button } from "@/components/ui/button";
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
import type { BoardCommittee } from "@/lib/events/board";
import { preventSearchFormSubmission } from "@/lib/search";
import {
  ACTIVE_TASK_PRIORITIES,
  ACTIVE_TASK_STALE_MESSAGE,
  type ActiveTaskDraft,
  type ActiveTaskPriority,
  type ActiveTaskType,
  type ActiveTaskValidationField,
  validateCreateActiveTaskRequest,
  validateEditActiveTaskRequest,
} from "@/lib/tasks/active-task";
import {
  activeTaskPickerLimitMessage,
  buildActiveTaskEditDraft,
  buildBulkPersonSelection,
  buildSinglePersonSelection,
  getActiveTaskBulkPresentation,
  nextActiveTaskPickerLimitAttempt,
  normalizeActiveTaskDraft,
  parseStoredTaskPriority,
  prepareActiveTaskEditSubmission,
  shouldApplyActiveTaskLoadResult,
  type ActiveTaskPickerLimitAttempt,
  type ActiveTaskViewer,
} from "@/lib/tasks/active-task-ui";
import { isTaskDetail } from "@/lib/tasks/detail";
import {
  isTaskEditControlData,
  MAX_TASK_ALLOWED_VIEWERS,
  MAX_TASK_ASSIGNEES,
  type TaskEditControlData,
  type TaskEditViewer,
} from "@/lib/tasks/edit-controls";
import {
  isTaskAssigneeWorkload,
  type TaskAssigneeWorkload,
} from "@/lib/tasks/workload";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type PersonOption = TaskEditViewer & {
  committee_id: string | null;
  active_task_count: number | null;
  is_active: boolean;
};

type ActiveTaskDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "add" | "edit";
  eventId?: string;
  taskId?: string;
  defaultPhase?: string | null;
  viewer: ActiveTaskViewer;
  committees: BoardCommittee[];
  onSettled: () => Promise<void>;
};

const EMPTY_DRAFT: ActiveTaskDraft = {
  title: "",
  description: "",
  phase: "Unphased",
  committeeId: "",
  priority: "Medium",
  taskType: "Deliverable",
  dueDate: "",
  dutyDate: "",
  callTime: "",
  endTime: "",
  primaryAssigneeIds: [],
  isConfidential: false,
  allowedViewerIds: [],
};

function focusActiveTaskValidationField(field: ActiveTaskValidationField) {
  if (field === "form") return;
  window.requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(
      `[data-active-task-field="${field}"]`,
    );
    if (!target) return;
    const control = target.matches("input, textarea, button, select")
      ? target
      : target.querySelector<HTMLElement>(
          "input:not(:disabled), textarea:not(:disabled), button:not(:disabled), select:not(:disabled)",
        );
    if (!control) return;
    control.scrollIntoView({ block: "center" });
    control.focus();
  });
}

function personName(person: TaskEditViewer) {
  return person.full_name?.trim() || "Former member";
}

function workloadPeople(rows: TaskAssigneeWorkload[]): PersonOption[] {
  return rows.map((row) => ({
    id: row.out_id,
    full_name: row.out_full_name,
    avatar_url: row.out_avatar_url,
    committee_id: row.out_committee_id,
    active_task_count: row.out_active_task_count,
    is_active: true,
  }));
}

function mergePeople(
  active: PersonOption[],
  controls: TaskEditControlData | null,
) {
  const people = new Map(active.map((person) => [person.id, person]));
  for (const person of [
    ...(controls?.primary_assignees ?? []),
    ...(controls?.assist_assignees ?? []),
    ...(controls?.allowed_viewers ?? []),
    ...(controls?.viewer_options ?? []),
    ...(controls?.assignee_options ?? []),
  ]) {
    if (!people.has(person.id)) {
      people.set(person.id, {
        ...person,
        committee_id: null,
        active_task_count: null,
        is_active: false,
      });
    }
  }
  return [...people.values()].sort((a, b) =>
    personName(a).localeCompare(personName(b)),
  );
}

function PersonPicker({
  label,
  people,
  selectedIds,
  disabledIds = new Set<string>(),
  limit,
  search,
  onSearchChange,
  onChange,
  onLimitError,
  bulkCommittee,
  fieldName,
}: {
  label: string;
  people: PersonOption[];
  selectedIds: string[];
  disabledIds?: ReadonlySet<string>;
  limit: number;
  search: string;
  onSearchChange: (value: string) => void;
  onChange: (ids: string[]) => void;
  onLimitError: (attemptedCount: number) => void;
  bulkCommittee?: BoardCommittee;
  fieldName: "primaryAssignees" | "allowedViewers";
}) {
  const filtered = people.filter((person) =>
    personName(person)
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  const committeePeople = bulkCommittee
    ? people.filter(
        (person) =>
          person.is_active &&
          person.committee_id === bulkCommittee.id &&
          !disabledIds.has(person.id),
      )
    : [];
  const filteredIdSet = new Set(filtered.map((person) => person.id));
  const bulkPeople = committeePeople.filter((person) =>
    filteredIdSet.has(person.id),
  );
  const bulkIds = bulkPeople.map((person) => person.id);
  const selectedBulkCount = bulkIds.filter((id) => selectedIds.includes(id)).length;
  const allBulkSelected = bulkIds.length > 0 && selectedBulkCount === bulkIds.length;
  const someBulkSelected = selectedBulkCount > 0 && !allBulkSelected;
  const bulkPresentation = bulkCommittee
    ? getActiveTaskBulkPresentation(
        bulkCommittee.name,
        committeePeople.length,
        bulkPeople.length,
        selectedBulkCount,
      )
    : null;
  const bulkCheckbox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (bulkCheckbox.current) bulkCheckbox.current.indeterminate = someBulkSelected;
  }, [someBulkSelected]);

  function updateBulkSelection(checked: boolean) {
    if (bulkIds.length === 0) return;
    const attempt = buildBulkPersonSelection(
      selectedIds,
      bulkIds,
      checked,
      limit,
    );
    if (attempt.exceedsLimit) {
      onLimitError(attempt.attemptedCount);
      return;
    }
    onChange(attempt.ids);
  }

  return (
    <fieldset className="grid min-w-0 gap-2.5" data-active-task-field={fieldName}>
      <legend className="text-sm font-semibold">{label}</legend>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label={`Search ${label.toLocaleLowerCase()}`}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={preventSearchFormSubmission}
          className="pl-9"
        />
      </div>
      {bulkCommittee && bulkPresentation?.showControls ? (
        <div className="flex items-center gap-2 rounded-lg border px-2">
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-2.5 px-1 text-sm font-semibold transition-colors hover:text-primary focus-within:ring-2 focus-within:ring-ring active:text-primary motion-reduce:transition-none">
            <input
              ref={bulkCheckbox}
              type="checkbox"
              checked={allBulkSelected}
              aria-checked={someBulkSelected ? "mixed" : allBulkSelected}
              disabled={bulkIds.length === 0}
              onChange={(event) => updateBulkSelection(event.target.checked)}
              className="size-4 accent-primary"
            />
            <span className="min-w-0 flex-1 truncate">
              Select all shown in {bulkCommittee.name} ({bulkIds.length})
            </span>
          </label>
          {bulkPresentation.showClear ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-11 shrink-0"
              onClick={() => updateBulkSelection(false)}
            >
              Clear shown
            </Button>
          ) : null}
        </div>
      ) : bulkCommittee && bulkPresentation?.emptyMessage ? (
        <p className="px-1 text-xs text-muted-foreground">
          {bulkPresentation.emptyMessage}
        </p>
      ) : null}
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border bg-card p-1.5">
        {filtered.map((person) => {
          const selected = selectedIds.includes(person.id);
          const disabled = disabledIds.has(person.id);
          const id = `${label.replaceAll(" ", "-").toLowerCase()}-${person.id}`;
          return (
            <label
              key={person.id}
              htmlFor={id}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-[var(--motion-hover-duration)] hover:bg-muted focus-within:ring-2 focus-within:ring-ring active:bg-muted motion-reduce:transition-none",
                disabled && "cursor-not-allowed opacity-55",
              )}
            >
              <input
                id={id}
                type="checkbox"
                checked={selected}
                disabled={disabled}
                onChange={(event) => {
                  const attempt = buildSinglePersonSelection(
                    selectedIds,
                    person.id,
                    event.target.checked,
                    limit,
                  );
                  if (attempt.exceedsLimit) {
                    onLimitError(attempt.attemptedCount);
                    return;
                  }
                  onChange(attempt.ids);
                }}
                className="size-4 accent-primary"
              />
              <UserAvatar name={personName(person)} src={person.avatar_url} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">
                {personName(person)}
              </span>
              {disabled ? (
                <span className="text-xs text-muted-foreground">Assist</span>
              ) : person.active_task_count !== null ? (
                <span className="text-xs text-muted-foreground">
                  {person.active_task_count} active
                </span>
              ) : null}
            </label>
          );
        })}
        {filtered.length === 0 ? (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">
            No people match this search.
          </p>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {selectedIds.length} of {limit} selected
      </p>
    </fieldset>
  );
}

export function ActiveTaskDialog({
  open,
  onOpenChange,
  mode,
  eventId,
  taskId,
  defaultPhase,
  viewer,
  committees,
  onSettled,
}: ActiveTaskDialogProps) {
  const supabase = useMemo(() => createClient(), []);
  const committeesRef = useRef(committees);
  const [draft, setDraft] = useState<ActiveTaskDraft>(EMPTY_DRAFT);
  const [controls, setControls] = useState<TaskEditControlData | null>(null);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [assistIds, setAssistIds] = useState<Set<string>>(new Set());
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState<string | null>(null);
  const [initialEditDraft, setInitialEditDraft] = useState<ActiveTaskDraft | null>(null);
  const [requiresReload, setRequiresReload] = useState(false);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerLimitAttempt, setPickerLimitAttempt] =
    useState<ActiveTaskPickerLimitAttempt | null>(null);
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [viewerSearch, setViewerSearch] = useState("");

  useEffect(() => {
    committeesRef.current = committees;
  }, [committees]);

  const load = useCallback(async (background = false) => {
    if (!open) return;
    await Promise.resolve();
    if (!background) {
      setLoading(true);
      setError(null);
      setPickerLimitAttempt(nextActiveTaskPickerLimitAttempt({ type: "clear" }));
      setOptionsLoaded(false);
    }
    try {
      const workloadResult = await supabase.rpc(
        "list_active_task_assignees_with_workload",
      );
      if (
        workloadResult.error ||
        !Array.isArray(workloadResult.data) ||
        !workloadResult.data.every(isTaskAssigneeWorkload)
      ) {
        throw new Error("Task options could not be loaded.");
      }
      const activePeople = workloadPeople(workloadResult.data);

      if (mode === "add") {
        const fixedCommittee =
          viewer.role === "Co-Admin" ? viewer.committeeId ?? "" : "";
        if (!background) {
          setDraft({
            ...EMPTY_DRAFT,
            phase: defaultPhase?.trim() || "Unphased",
            committeeId: fixedCommittee,
          });
        }
        setControls(null);
        setAssistIds(new Set());
        setExpectedUpdatedAt(null);
        setPeople(activePeople);
        setInitialEditDraft(null);
        setRequiresReload(false);
        setOptionsLoaded(true);
        return;
      }

      if (!taskId) throw new Error("The task is unavailable.");
      const [detailResult, controlsResult, priorityResult] = await Promise.all([
        supabase.rpc("get_task_detail", { p_task_id: taskId }),
        supabase.rpc("get_task_edit_controls", { p_task_id: taskId }),
        supabase.rpc("get_task_stored_priority", { p_task_id: taskId }),
      ]);
      if (
        detailResult.error ||
        controlsResult.error ||
        priorityResult.error ||
        !Array.isArray(detailResult.data) ||
        detailResult.data.length !== 1 ||
        !isTaskDetail(detailResult.data[0]) ||
        !Array.isArray(controlsResult.data) ||
        controlsResult.data.length !== 1 ||
        !isTaskEditControlData(controlsResult.data[0])
      ) {
        throw new Error("The task could not be loaded for editing.");
      }
      const storedPriority = parseStoredTaskPriority(priorityResult.data);
      if (storedPriority === null || storedPriority === undefined) {
        throw new Error("The task could not be loaded for editing.");
      }
      const nextControls = controlsResult.data[0];
      const nextDraft = buildActiveTaskEditDraft(
        detailResult.data[0],
        nextControls,
        storedPriority,
      );
      if (!nextDraft || !detailResult.data[0].updated_at) {
        throw new Error("The task could not be loaded for editing.");
      }
      if (!committeesRef.current.some((committee) => committee.id === nextDraft.committeeId)) {
        throw new Error("The task's committee is unavailable. Reload and try again.");
      }
      if (!shouldApplyActiveTaskLoadResult(mode, background)) return;
      setDraft(nextDraft);
      setInitialEditDraft(nextDraft);
      setControls(nextControls);
      setAssistIds(new Set(nextControls.assist_assignees.map((person) => person.id)));
      setExpectedUpdatedAt(detailResult.data[0].updated_at);
      setPeople(mergePeople(activePeople, nextControls));
      setRequiresReload(false);
      setOptionsLoaded(true);
    } catch (loadError) {
      if (!background) {
        setExpectedUpdatedAt(null);
        setInitialEditDraft(null);
        setOptionsLoaded(false);
        setError(
          loadError instanceof Error
            ? loadError.message
            : "The task could not be loaded for editing.",
        );
      }
    } finally {
      if (!background) setLoading(false);
    }
  }, [defaultPhase, mode, open, supabase, taskId, viewer.committeeId, viewer.role]);

  useEffect(() => {
    if (!open) return;
    void Promise.resolve().then(() => load());
  }, [load, open]);

  function updateDraft(updates: Partial<ActiveTaskDraft>) {
    setDraft((current) => ({ ...current, ...updates }));
  }

  function clearPickerLimitAttempt() {
    setPickerLimitAttempt(nextActiveTaskPickerLimitAttempt({ type: "clear" }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading) return;
    setError(null);
    if (requiresReload) {
      setError(ACTIVE_TASK_STALE_MESSAGE);
      return;
    }
    if (mode === "edit" && (!taskId || !expectedUpdatedAt)) {
      setError("The task could not be loaded for editing.");
      return;
    }
    if (mode === "add" && !eventId) {
      setError("The event is unavailable.");
      return;
    }
    if (!committees.some((committee) => committee.id === draft.committeeId)) {
      setError(
        mode === "edit"
          ? "The task's committee is unavailable. Reload and try again."
          : "Choose an available committee.",
      );
      return;
    }

    let normalizedDraft = normalizeActiveTaskDraft(
      {
        ...draft,
        title: draft.title.trim(),
        phase: draft.phase.trim(),
        dutyDate: draft.taskType === "LiveOperation" ? draft.dutyDate : "",
        callTime: draft.taskType === "LiveOperation" ? draft.callTime : "",
        endTime: draft.taskType === "LiveOperation" ? draft.endTime : "",
        allowedViewerIds: draft.isConfidential ? draft.allowedViewerIds : [],
      },
      [...assistIds],
    );
    if (mode === "edit" && initialEditDraft) {
      const preparedDraft = prepareActiveTaskEditSubmission(
        normalizedDraft,
        initialEditDraft,
        [...assistIds],
      );
      if (!preparedDraft) {
        setError("No changes to save.");
        return;
      }
      normalizedDraft = preparedDraft;
    }
    const body = {
      ...(mode === "add"
        ? { eventId }
        : { taskId, expectedUpdatedAt }),
      ...normalizedDraft,
    };
    const validation =
      mode === "add"
        ? validateCreateActiveTaskRequest(body)
        : validateEditActiveTaskRequest(body);
    if (!validation.ok) {
      setError(validation.message);
      focusActiveTaskValidationField(validation.field);
      return;
    }
    setBusy(true);
    let saved = false;
    try {
      const response = await fetch("/api/active-task", {
        method: mode === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result: unknown = await response.json().catch(() => null);
      const message =
        result &&
        typeof result === "object" &&
        typeof (result as { error?: unknown }).error === "string"
          ? (result as { error: string }).error
          : null;
      if (!response.ok) throw new Error(message ?? "The task could not be saved.");
      saved = true;
    } catch (saveError) {
      if (saveError instanceof Error && saveError.message === ACTIVE_TASK_STALE_MESSAGE) {
        setRequiresReload(true);
      }
      setError(
        saveError instanceof Error
          ? saveError.message
          : "The task could not be saved. Please try again.",
      );
    } finally {
      try {
        await Promise.allSettled([onSettled(), load(true)]);
      } finally {
        setBusy(false);
      }
    }
    if (saved) {
      clearPickerLimitAttempt();
      onOpenChange(false);
    }
  }

  const fixedCommittee = committees.find(
    (committee) => committee.id === draft.committeeId,
  );
  const committeeItems = committees.map((committee) => ({
    value: committee.id,
    label: committee.name,
  }));
  const ready =
    !loading &&
    optionsLoaded &&
    (mode === "add" || Boolean(expectedUpdatedAt && controls?.can_edit_task));
  const visibleViewerPeople = people.filter(
    (person) =>
      !draft.primaryAssigneeIds.includes(person.id) && !assistIds.has(person.id),
  );
  const pickerLimitError = activeTaskPickerLimitMessage(pickerLimitAttempt);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) clearPickerLimitAttempt();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:p-0">
        <DialogHeader className="border-b px-4 py-3.5 pr-12 sm:px-5">
          <DialogTitle>{mode === "add" ? "Add task" : "Edit task"}</DialogTitle>
          <DialogDescription>
            {mode === "add"
              ? "Create a To Do task in the selected phase."
              : "Update task setup without changing its workflow state."}
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="grid min-h-52 place-items-center text-sm text-muted-foreground">
            <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
            <span className="sr-only">Loading task editor</span>
          </div>
        ) : (
          <form onSubmit={submit} className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
            <div className="grid min-h-0 gap-5 overflow-y-auto px-4 py-4 sm:px-5 [&_button]:transition-colors [&_button]:duration-[var(--motion-interaction-duration)] [&_button]:hover:border-primary/60 [&_button]:active:bg-muted motion-reduce:[&_button]:transition-none">
              {error && !ready ? (
                <div className="grid gap-3">
                  <InlineAlert>{error}</InlineAlert>
                  <Button type="button" variant="outline" className="h-11 justify-self-start" onClick={() => void load(false)}>
                    Reload task editor
                  </Button>
                </div>
              ) : null}
              {ready ? (
                <>
                  <SectionEnter as="section" index={0} className="grid gap-4 border-b pb-5">
                    <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase">
                      <FileText className="size-4" aria-hidden /> Details
                    </h3>
                    <FormField label="Title">
                      {(control) => (
                        <Input {...control} data-active-task-field="title" maxLength={200} autoFocus value={draft.title} onChange={(event) => updateDraft({ title: event.target.value })} />
                      )}
                    </FormField>
                    <FormField label="Description" hint="Optional · up to 2,000 characters">
                      {(control) => (
                        <textarea {...control} data-active-task-field="description" rows={3} maxLength={2000} value={draft.description} onChange={(event) => updateDraft({ description: event.target.value })} className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition-[color,box-shadow,border-color] hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 active:border-primary motion-reduce:transition-none" />
                      )}
                    </FormField>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField label="Phase">
                        {(control) => (
                          <Input {...control} data-active-task-field="phase" maxLength={100} value={draft.phase} onChange={(event) => updateDraft({ phase: event.target.value })} />
                        )}
                      </FormField>
                      <FormField label="Priority">
                        {(control) => (
                          <Select value={draft.priority} onValueChange={(value) => value && updateDraft({ priority: value as ActiveTaskPriority })}>
                            <SelectTrigger {...control} data-active-task-field="priority"><SelectValue className="sr-only" /><PriorityBadge priority={draft.priority} aria-hidden /></SelectTrigger>
                            <SelectContent>{ACTIVE_TASK_PRIORITIES.map((priority) => <SelectItem key={priority} value={priority}><PriorityBadge priority={priority} /></SelectItem>)}</SelectContent>
                          </Select>
                        )}
                      </FormField>
                    </div>
                    <FormField label="Committee">
                      {(control) => viewer.role === "Co-Admin" ? (
                        <Input {...control} data-active-task-field="committee" value={fixedCommittee?.name ?? "Your committee"} readOnly aria-readonly="true" />
                      ) : (
                        <Select items={committeeItems} value={draft.committeeId || null} onValueChange={(value) => { clearPickerLimitAttempt(); updateDraft({ committeeId: value ?? "" }); }}>
                          <SelectTrigger {...control} data-active-task-field="committee"><SelectValue placeholder="Select a committee" /></SelectTrigger>
                          <SelectContent>{committees.map((committee) => <SelectItem key={committee.id} value={committee.id}>{committee.name}</SelectItem>)}</SelectContent>
                        </Select>
                      )}
                    </FormField>
                  </SectionEnter>

                  <SectionEnter as="section" index={1} className="grid gap-4 border-b pb-5">
                    <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase"><CalendarDays className="size-4" aria-hidden /> Schedule</h3>
                    <FormField label="Type" labelTarget="group">
                      {(control) => (
                        <div {...control} data-active-task-field="taskType" className="grid grid-cols-2 gap-2">
                          {(["Deliverable", "LiveOperation"] as ActiveTaskType[]).map((type) => (
                            <Button key={type} type="button" variant="outline" className={cn("h-11", draft.taskType === type && "border-primary bg-primary/10 text-primary")} aria-pressed={draft.taskType === type} onClick={() => updateDraft({ taskType: type, ...(type === "Deliverable" ? { dutyDate: "", callTime: "", endTime: "" } : {}) })}>{type === "LiveOperation" ? "Live Operation" : type}</Button>
                          ))}
                        </div>
                      )}
                    </FormField>
                    <FormField label="Due date" hint="Optional">
                      {(control) => <Input {...control} data-active-task-field="dueDate" type="date" value={draft.dueDate} onChange={(event) => updateDraft({ dueDate: event.target.value })} />}
                    </FormField>
                    <MotionPresence open={draft.taskType === "LiveOperation"}>
                      {draft.taskType === "LiveOperation" ? (
                        <div data-active-task-field="schedule" className="grid gap-3 border-l-2 border-primary/40 pl-3 sm:grid-cols-3">
                          <FormField label="Philippine duty date">{(control) => <Input {...control} type="date" value={draft.dutyDate} onChange={(event) => updateDraft({ dutyDate: event.target.value })} />}</FormField>
                          <FormField label="Call time">{(control) => <Input {...control} type="time" value={draft.callTime} onChange={(event) => updateDraft({ callTime: event.target.value })} />}</FormField>
                          <FormField label="End time" hint="Optional">{(control) => <Input {...control} type="time" min={draft.callTime || undefined} value={draft.endTime} onChange={(event) => updateDraft({ endTime: event.target.value })} />}</FormField>
                        </div>
                      ) : null}
                    </MotionPresence>
                  </SectionEnter>

                  <SectionEnter as="section" index={2} className="grid gap-4">
                    <h3 className="flex items-center gap-2 text-xs font-bold tracking-wide text-muted-foreground uppercase"><Users className="size-4" aria-hidden /> People and access</h3>
                    <PersonPicker
                      label="Primary assignees"
                      people={people}
                      selectedIds={draft.primaryAssigneeIds}
                      disabledIds={assistIds}
                      limit={MAX_TASK_ASSIGNEES}
                      search={assigneeSearch}
                      onSearchChange={(value) => { clearPickerLimitAttempt(); setAssigneeSearch(value); }}
                      onLimitError={(attemptedCount) =>
                        setPickerLimitAttempt(
                          nextActiveTaskPickerLimitAttempt({
                            type: "overflow",
                            kind: "primary",
                            attemptedCount,
                          }),
                        )
                      }
                      bulkCommittee={fixedCommittee}
                      fieldName="primaryAssignees"
                      onChange={(primaryAssigneeIds) => {
                        clearPickerLimitAttempt();
                        updateDraft({
                          primaryAssigneeIds,
                          allowedViewerIds: draft.allowedViewerIds.filter(
                            (id) => !primaryAssigneeIds.includes(id) && !assistIds.has(id),
                          ),
                        })
                      }}
                    />
                    <label htmlFor="active-task-confidential" data-active-task-field="confidentiality" className="flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-sm font-semibold transition-colors hover:border-primary/60 focus-within:ring-2 focus-within:ring-ring active:bg-muted motion-reduce:transition-none">
                      Confidential
                      <input id="active-task-confidential" type="checkbox" checked={draft.isConfidential} onChange={(event) => updateDraft({ isConfidential: event.target.checked, allowedViewerIds: event.target.checked ? draft.allowedViewerIds : [] })} className="size-4 accent-primary" />
                    </label>
                    <MotionPresence open={draft.isConfidential}>
                      {draft.isConfidential ? (
                        <PersonPicker
                          label="Additional viewers"
                          people={visibleViewerPeople}
                          selectedIds={draft.allowedViewerIds}
                          limit={MAX_TASK_ALLOWED_VIEWERS}
                          search={viewerSearch}
                          onSearchChange={(value) => { clearPickerLimitAttempt(); setViewerSearch(value); }}
                          onLimitError={(attemptedCount) =>
                            setPickerLimitAttempt(
                              nextActiveTaskPickerLimitAttempt({
                                type: "overflow",
                                kind: "viewer",
                                attemptedCount,
                              }),
                            )
                          }
                          fieldName="allowedViewers"
                          onChange={(allowedViewerIds) => { clearPickerLimitAttempt(); updateDraft({ allowedViewerIds }); }}
                        />
                      ) : null}
                    </MotionPresence>
                  </SectionEnter>
                </>
              ) : null}
            </div>
            <div className="grid gap-3 border-t bg-popover p-4 sm:px-5">
              {error && ready ? (
                <div className="grid gap-2">
                  <InlineAlert>{error}</InlineAlert>
                  {requiresReload ? (
                    <Button type="button" variant="outline" className="h-11 justify-self-start" onClick={() => void load(false)} disabled={busy}>
                      Reload task
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {pickerLimitError && ready ? <InlineAlert>{pickerLimitError}</InlineAlert> : null}
              <DialogFooter className="grid grid-cols-2 sm:flex">
                <Button type="button" variant="outline" className="h-11 w-full sm:w-auto" onClick={() => { clearPickerLimitAttempt(); onOpenChange(false); }} disabled={busy}>Cancel</Button>
                <Button type="submit" className="h-11 w-full sm:w-auto" disabled={!ready || busy} aria-busy={busy}>{busy ? "Saving…" : mode === "add" ? "Add task" : "Save changes"}</Button>
              </DialogFooter>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

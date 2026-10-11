"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Pencil,
  Plus,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PageHeader } from "@/components/shared/page-header";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { Committee, Role } from "@/lib/types";

type AssigneeOption = {
  id: string;
  full_name: string;
  committee_id: string | null;
  avatar_url: string | null;
};

type TaskType = "Deliverable" | "LiveOperation";
type Priority = "Low" | "Medium" | "High" | "Critical";

type TaskDraft = {
  id: string;
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

type TaskEditor = {
  phaseId: string;
  taskId: string | null;
  draft: Omit<TaskDraft, "id">;
};

type CreateEventFormProps = {
  role: Extract<Role, "Admin" | "Co-Admin">;
  committees: Committee[];
  taskCommittees: Committee[];
  assignees: AssigneeOption[];
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

function toTimestamp(date: string, time: string) {
  if (!date || !time) return null;
  return new Date(`${date}T${time}:00`).toISOString();
}

export function CreateEventForm({
  role,
  committees,
  taskCommittees,
  assignees,
}: CreateEventFormProps) {
  const router = useRouter();
  const [tab, setTab] = useState<"fundamentals" | "tasks">("fundamentals");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [phases, setPhases] = useState<PhaseDraft[]>([]);
  const [newPhaseName, setNewPhaseName] = useState("");
  const [taskEditor, setTaskEditor] = useState<TaskEditor | null>(null);
  const [taskEditorError, setTaskEditorError] = useState("");
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const [phaseToRemove, setPhaseToRemove] = useState<PhaseDraft | null>(null);
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState("");

  const taskCount = phases.reduce((sum, phase) => sum + phase.tasks.length, 0);
  const nameSet = name.trim().length > 0;
  const startSet = startDate.length > 0;
  const datesSet = startSet && endDate.length > 0;
  const datesOutOfOrder = datesSet && endDate < startDate;
  const phasesValid = phases.every(
    (phase) => phase.tasks.length === 0 || phase.name.trim().length > 0,
  );
  const readyToLaunch =
    nameSet && datesSet && !datesOutOfOrder && taskCount > 0 && phasesValid;

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
    const filtered = assignees.filter(matchesSearch);

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
  }, [assigneeSearch, assignees, committeeNames, taskEditor]);

  const selectedCommitteeHasActiveMembers = taskEditor
    ? assignees.some(
        (assignee) => assignee.committee_id === taskEditor.draft.committeeId,
      )
    : false;

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
  }

  function openEditTask(phaseId: string, task: TaskDraft) {
    const { id: taskId, ...draft } = task;
    setTaskEditorError("");
    setAssigneeSearch("");
    setTaskEditor({ phaseId, taskId, draft });
  }

  function updateTaskDraft(updates: Partial<TaskEditor["draft"]>) {
    setTaskEditor((current) =>
      current
        ? { ...current, draft: { ...current.draft, ...updates } }
        : current,
    );
  }

  function saveTask() {
    if (!taskEditor) return;

    const title = taskEditor.draft.title.trim();
    if (!title) {
      setTaskEditorError("Give the task a title.");
      return;
    }
    if (!taskEditor.draft.committeeId) {
      setTaskEditorError("Choose a committee.");
      return;
    }
    if (
      taskEditor.draft.taskType === "LiveOperation" &&
      (taskEditor.draft.callDate ||
        taskEditor.draft.callTime ||
        taskEditor.draft.endTime) &&
      (!taskEditor.draft.callDate || !taskEditor.draft.callTime)
    ) {
      setTaskEditorError(
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
      setTaskEditorError("End time cannot be before call time.");
      return;
    }

    const savedTask: TaskDraft = {
      id: taskEditor.taskId ?? makeId(),
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
    setTaskEditor(null);
    setTaskEditorError("");
    setError("");
  }

  function removeTask(phaseId: string, taskId: string) {
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
    if (launch && taskCount === 0) {
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
        title: task.title,
        description: task.description || null,
        phase: phase.name.trim(),
        committee_id: task.committeeId,
        task_type: task.taskType,
        due_date: task.dueDate || null,
        call_time:
          task.taskType === "LiveOperation"
            ? toTimestamp(task.callDate, task.callTime)
            : null,
        end_time:
          task.taskType === "LiveOperation"
            ? toTimestamp(task.callDate, task.endTime)
            : null,
        priority: task.priority,
        assignee_ids: task.assigneeIds,
      })),
    );

    try {
      const supabase = createClient();
      const { error: saveError } = await supabase.rpc(
        "create_event_with_tasks",
        {
          p_name: name.trim(),
          p_description: description.trim() || null,
          p_start_date: startDate,
          p_end_date: endDate || null,
          p_status: launch ? "Active" : "Draft",
          p_tasks: tasks,
        },
      );

      if (saveError) {
        setError(saveError.message);
        setStatus("idle");
        return;
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
        title="Create Event"
        description="Set the event details and prepare its initial task backlog."
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card>
          <div className="flex gap-1 border-b px-5 pt-3 sm:px-6">
            <button
              type="button"
              onClick={() => setTab("fundamentals")}
              className={`border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
                tab === "fundamentals"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              Fundamentals
            </button>
            <button
              type="button"
              onClick={() => setTab("tasks")}
              className={`border-b-2 px-3 py-3 text-sm font-semibold transition-colors ${
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
              <div className="grid gap-5">
                <div className="flex aspect-[21/9] items-center justify-center rounded-xl border-2 border-dashed bg-muted/40 px-4 text-center text-sm text-muted-foreground">
                  Banner upload is planned for a later step
                </div>

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
                      className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:bg-input/30"
                    />
                  )}
                </FormField>

                <Button
                  type="button"
                  variant="link"
                  className="w-fit px-0"
                  onClick={() => setTab("tasks")}
                >
                  Continue to Task Setup
                  <ChevronRight />
                </Button>
              </div>
            ) : (
              <div className="grid gap-5">
                <InlineAlert variant="info">
                  A phase with no tasks will not be saved. Add at least one task
                  to every phase you want to keep.
                </InlineAlert>

                {role === "Co-Admin" && (
                  <p className="text-sm text-muted-foreground">
                    As a Co-Admin, you can create and assign tasks only within
                    your own committee.
                  </p>
                )}

                {phases.length === 0 ? (
                  <div className="rounded-2xl border-2 border-dashed p-8 text-center">
                    <ClipboardList className="mx-auto size-8 text-muted-foreground" />
                    <p className="mt-3 font-semibold">No phases yet</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Add a phase, then place its tasks into the backlog.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-4">
                    {phases.map((phase) => (
                      <section key={phase.id} className="rounded-2xl border">
                        <div className="flex items-center gap-2 border-b bg-muted/40 p-3">
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
                            {phase.collapsed ? (
                              <ChevronRight />
                            ) : (
                              <ChevronDown />
                            )}
                          </Button>
                          <Input
                            aria-label="Phase name"
                            maxLength={100}
                            value={phase.name}
                            onChange={(event) =>
                              updatePhaseName(phase.id, event.target.value)
                            }
                            className="h-8 flex-1 border-transparent bg-transparent font-semibold shadow-none hover:border-border"
                          />
                          <Badge variant="neutral">
                            {phase.tasks.length} task
                            {phase.tasks.length === 1 ? "" : "s"}
                          </Badge>
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon-sm"
                            aria-label={`Remove ${phase.name}`}
                            onClick={() => setPhaseToRemove(phase)}
                          >
                            <Trash2 />
                          </Button>
                        </div>

                        {!phase.collapsed && (
                          <div className="grid gap-3 p-3">
                            {phase.tasks.map((task) => {
                              const committee = committees.find(
                                (item) => item.id === task.committeeId,
                              );
                              return (
                                <div
                                  key={task.id}
                                  className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
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
                                      <span>{task.priority}</span>
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
                                      variant="destructive"
                                      size="icon-sm"
                                      aria-label={`Remove ${task.title}`}
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
                        )}
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
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit lg:sticky lg:top-8">
          <CardHeader>
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
              <SummaryCheck done={taskCount > 0}>
                At least one task added
              </SummaryCheck>
            </div>

            {error && <InlineAlert>{error}</InlineAlert>}

            <Button
              type="button"
              variant="outline"
              size="lg"
              disabled={status === "saving"}
              onClick={() => handleSave(false)}
            >
              {status === "saving" ? "Saving…" : "Save Draft"}
            </Button>
            <Button
              type="button"
              size="lg"
              disabled={status === "saving" || !readyToLaunch}
              onClick={() => handleSave(true)}
            >
              {status === "saving" ? "Saving…" : "Launch Event"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Launch requires valid dates and at least one task. Drafts may be
              saved without tasks.
            </p>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={taskEditor !== null}
        onOpenChange={(open) => {
          if (!open) setTaskEditor(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {taskEditor?.taskId ? "Edit task" : "Add task"}
            </DialogTitle>
            <DialogDescription>
              Leave assignees empty to send this task to the Backlog.
            </DialogDescription>
          </DialogHeader>

          {taskEditor && (
            <div className="grid gap-4">
              <FormField label="Task title">
                {(control) => (
                  <Input
                    {...control}
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
                    className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:bg-input/30"
                  />
                )}
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
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
                      <SelectTrigger {...control}>
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

                <FormField label="Type">
                  {(control) => (
                    <Select
                      items={taskTypes}
                      value={taskEditor.draft.taskType}
                      onValueChange={(value) =>
                        value && updateTaskDraft({ taskType: value })
                      }
                    >
                      <SelectTrigger {...control}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {taskTypes.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>

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
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {priorities.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            {priority}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FormField>
              </div>

              {taskEditor.draft.taskType === "LiveOperation" && (
                <div className="grid gap-4 rounded-xl border border-primary/30 bg-muted p-4">
                  <InlineAlert variant="info">
                    This is a live duty — don&apos;t start before Call Time, and
                    be physically ready at that moment.
                  </InlineAlert>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <FormField label="Duty date" hint="Optional">
                      {(control) => (
                        <Input
                          {...control}
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
                </div>
              )}

              <fieldset className="grid gap-2 rounded-xl border p-3">
                <legend className="px-1 text-sm font-semibold">
                  Assignees
                </legend>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search assignees"
                    value={assigneeSearch}
                    onChange={(event) => setAssigneeSearch(event.target.value)}
                    placeholder="Search members…"
                    className="pl-9"
                  />
                </div>

                <div className="grid max-h-72 gap-3 overflow-y-auto rounded-xl bg-muted/30 p-2">
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
                  Tasks are unassigned by default and stay in the Backlog until
                  someone claims or is assigned to them.
                </p>
              </fieldset>

              {taskEditorError && <InlineAlert>{taskEditorError}</InlineAlert>}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTaskEditor(null)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={saveTask}>
              {taskEditor?.taskId ? "Save changes" : "Add task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={phaseToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setPhaseToRemove(null);
        }}
        title="Remove this phase?"
        description={
          phaseToRemove?.tasks.length
            ? `This also removes ${phaseToRemove.tasks.length} unsaved task${phaseToRemove.tasks.length === 1 ? "" : "s"} from the form.`
            : "This removes the empty phase from the form."
        }
        confirmLabel="Remove phase"
        destructive
        onConfirm={() => {
          if (phaseToRemove) {
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
        className={`size-4 shrink-0 rounded-full border-2 ${
          done ? "border-primary bg-primary" : "border-border"
        }`}
      />
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
        return (
          <label
            key={assignee.id}
            htmlFor={inputId}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 hover:bg-muted"
          >
            <input
              id={inputId}
              type="checkbox"
              checked={selectedIds.includes(assignee.id)}
              onChange={(event) => onToggle(assignee.id, event.target.checked)}
              className="size-4 accent-primary"
            />
            <UserAvatar
              name={assignee.full_name}
              src={assignee.avatar_url}
              size="sm"
              className="size-7 text-[10px]"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {assignee.full_name}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {assignee.committee_id
                ? (committeeNames.get(assignee.committee_id) ??
                  "Unknown committee")
                : "No committee"}
            </span>
          </label>
        );
      })}
    </div>
  );
}

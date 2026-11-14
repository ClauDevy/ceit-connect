import { splitAppTimestamp, toAppTimestamp } from "../timezone";

export type EventFormPhaseOrigin = "persisted" | "local" | "reader-shell";

export const EVENT_ASSIGNEE_LIMIT_MESSAGE = "Select up to 100 people.";

export function getInitialEventTaskCommitteeId(
  role: "Admin" | "Co-Admin",
  committees: readonly { id: string }[],
) {
  return role === "Co-Admin"
    ? (committees.length === 1 ? committees[0].id : "")
    : "";
}

export function updateEventAssigneeSelection(
  selectedIds: readonly string[],
  assigneeId: string,
  checked: boolean,
) {
  if (!checked) {
    return {
      ids: selectedIds.filter((id) => id !== assigneeId),
      error: null,
    };
  }
  if (selectedIds.includes(assigneeId)) return { ids: [...selectedIds], error: null };
  if (selectedIds.length >= 100) {
    return { ids: [...selectedIds], error: EVENT_ASSIGNEE_LIMIT_MESSAGE };
  }
  return { ids: [...selectedIds, assigneeId], error: null };
}

export function getCommitteeScopedEventAssignees<T extends { committee_id: string | null }>(
  assignees: readonly T[],
  committeeId: string,
) {
  return assignees.filter((assignee) => assignee.committee_id === committeeId);
}

export type EventFormTaskRef = {
  id: string;
  persisted: boolean;
  templateEditable?: boolean;
};

export type EventFormPhaseRef<TTask extends EventFormTaskRef = EventFormTaskRef> = {
  id: string;
  name: string;
  originalName: string;
  origin: EventFormPhaseOrigin;
  tasks: TTask[];
};

export type EventFormReaderTaskRef = {
  out_task_id: string;
  out_phase: string | null;
  phaseComplete?: boolean;
};

export function getEventTaskEndDateInputValue({
  callDate,
  endDate,
  endTime,
}: {
  callDate: string;
  endDate: string;
  endTime: string;
}) {
  return endTime && endDate !== callDate ? endDate : "";
}

export function excludeCompletedPhaseTaskMutations<
  TTask extends EventFormTaskRef,
  TPhase extends EventFormPhaseRef<TTask>,
>(phases: readonly TPhase[], completedPhases: ReadonlySet<string>) {
  return phases.flatMap((phase) =>
    completedPhases.has(normalizeEventPhaseName(phase.name))
      ? []
      : phase.tasks.map((task) => ({ phase, task })),
  );
}

export type EventPhaseView<
  TPhase extends EventFormPhaseRef = EventFormPhaseRef,
  TReaderTask extends EventFormReaderTaskRef = EventFormReaderTaskRef,
> = {
  key: string;
  name: string;
  editablePhases: TPhase[];
  readOnlyTasks: TReaderTask[];
  isReaderShell: boolean;
};

export function normalizeEventPhaseName(value: string | null | undefined) {
  return value?.trim() || "Unphased";
}

export function getSavableEventPhaseName(
  phase: Pick<EventFormPhaseRef, "name" | "originalName" | "origin">,
) {
  const currentName = phase.name.trim();
  if (currentName) return currentName;
  return phase.origin === "persisted" ? phase.originalName.trim() : "";
}

export function eventFormPhasesAreValid(
  phases: readonly Pick<
    EventFormPhaseRef,
    "name" | "originalName" | "origin" | "tasks"
  >[],
) {
  return phases.every(
    (phase) =>
      phase.tasks.length === 0 || getSavableEventPhaseName(phase).length > 0,
  );
}

type EventPhaseSaveAction =
  | { type: "rename"; phase: string; next_phase: string }
  | { type: "delete"; phase: string };

export function buildCompleteEventPhaseOrder({
  serverOrder,
  visibleOrder,
  phaseActions,
  applyVisibleOrder = true,
}: {
  serverOrder: readonly string[];
  visibleOrder: readonly string[];
  phaseActions: readonly EventPhaseSaveAction[];
  applyVisibleOrder?: boolean;
}) {
  const unique = (names: readonly string[]) =>
    names.reduce<string[]>((result, name) => {
      const normalized = normalizeEventPhaseName(name);
      if (!result.includes(normalized)) result.push(normalized);
      return result;
    }, []);
  let transformed = unique(serverOrder);

  for (const action of phaseActions) {
    const source = normalizeEventPhaseName(action.phase);
    if (action.type === "delete") {
      transformed = transformed.filter((name) => name !== source);
      continue;
    }
    if (!action.next_phase.trim()) continue;
    const destination = normalizeEventPhaseName(action.next_phase);
    if (destination === source) continue;
    if (transformed.includes(destination)) {
      transformed = transformed.filter((name) => name !== source);
    } else {
      transformed = transformed.map((name) =>
        name === source ? destination : name,
      );
    }
  }

  const requested = unique(visibleOrder);
  if (!applyVisibleOrder) {
    return [
      ...transformed,
      ...requested.filter((name) => !transformed.includes(name)),
    ];
  }
  const requestedExisting = requested.filter((name) =>
    transformed.includes(name),
  );
  let requestedIndex = 0;
  const requestedSet = new Set(requestedExisting);
  const merged = transformed.map((name) =>
    requestedSet.has(name) ? requestedExisting[requestedIndex++] : name,
  );
  for (const name of requested) {
    if (!merged.includes(name)) merged.push(name);
  }
  return merged;
}

export function buildEventPhaseViews<
  TPhase extends EventFormPhaseRef,
  TReaderTask extends EventFormReaderTaskRef,
>(editablePhases: TPhase[], readOnlyTasks: TReaderTask[]) {
  const views = new Map<string, EventPhaseView<TPhase, TReaderTask>>();

  for (const phase of editablePhases) {
    const name = normalizeEventPhaseName(phase.name);
    const view = views.get(name) ?? {
      key: name,
      name,
      editablePhases: [],
      readOnlyTasks: [],
      isReaderShell: false,
    };
    view.editablePhases.push(phase);
    views.set(name, view);
  }

  for (const task of readOnlyTasks) {
    const name = normalizeEventPhaseName(task.out_phase);
    const view = views.get(name) ?? {
      key: name,
      name,
      editablePhases: [],
      readOnlyTasks: [],
      isReaderShell: false,
    };
    view.readOnlyTasks.push(task);
    views.set(name, view);
  }

  return Array.from(views.values())
    .filter(
      (view) =>
        view.readOnlyTasks.length > 0 ||
        view.editablePhases.some(
          (phase) =>
            phase.origin !== "reader-shell" || phase.tasks.length > 0,
        ),
    )
    .map((view) => ({
      ...view,
      isReaderShell:
        view.readOnlyTasks.length > 0 &&
        (view.editablePhases.length === 0 ||
          view.editablePhases.every(
            (phase) => phase.origin === "reader-shell",
          )),
    }));
}

export function getEventPhaseCardKey<
  TPhase extends EventFormPhaseRef,
  TReaderTask extends EventFormReaderTaskRef,
>(phase: EventPhaseView<TPhase, TReaderTask>) {
  return phase.editablePhases[0]?.id ?? phase.key;
}

export function getEventFormSummary<
  TPhase extends EventFormPhaseRef,
  TReaderTask extends EventFormReaderTaskRef,
>(
  editablePhases: TPhase[],
  readOnlyTasks: TReaderTask[],
  deletedTaskIds: ReadonlySet<string>,
) {
  const taskKeys = new Set<string>();
  const phaseViews = buildEventPhaseViews(editablePhases, readOnlyTasks);

  for (const phase of phaseViews) {
    for (const editablePhase of phase.editablePhases) {
      for (const task of editablePhase.tasks) {
        if (deletedTaskIds.has(task.id)) continue;
        taskKeys.add(`${task.persisted ? "stored" : "local"}:${task.id}`);
      }
    }
    for (const task of phase.readOnlyTasks) {
      if (!deletedTaskIds.has(task.out_task_id)) {
        taskKeys.add(`stored:${task.out_task_id}`);
      }
    }
  }

  return {
    phaseCount: phaseViews.length,
    taskCount: taskKeys.size,
    hasTasks: taskKeys.size > 0,
  };
}

export function getEventPhaseControls<
  TPhase extends EventFormPhaseRef,
  TReaderTask extends EventFormReaderTaskRef,
>({
  role,
  isDraft,
  readerAvailable,
  hasExactlyOneTaskCommittee,
  phase,
  readOnlyTasks,
}: {
  role: "Admin" | "Co-Admin";
  isDraft: boolean;
  readerAvailable: boolean;
  hasExactlyOneTaskCommittee: boolean;
  phase: EventPhaseView<TPhase, TReaderTask>;
  readOnlyTasks: TReaderTask[];
}) {
  const editablePhase =
    phase.editablePhases.length === 1 ? phase.editablePhases[0] : null;
  const originalPhaseHasReadOnlyTasks = editablePhase
    ? readOnlyTasks.some(
        (task) =>
          normalizeEventPhaseName(task.out_phase) ===
          normalizeEventPhaseName(editablePhase.originalName),
      )
    : false;
  const coAdminDraftActionsBlocked =
    role === "Co-Admin" &&
    isDraft &&
    (!readerAvailable || originalPhaseHasReadOnlyTasks);
  const coAdminTemplateActionsBlocked =
    role === "Co-Admin" &&
    phase.editablePhases.some((candidate) =>
      candidate.tasks.some((task) => task.templateEditable === false),
    );
  const canMutatePhase =
    editablePhase !== null &&
    normalizeEventPhaseName(editablePhase.originalName) !== "Unphased" &&
    !phase.isReaderShell &&
    !coAdminDraftActionsBlocked &&
    !coAdminTemplateActionsBlocked;

  return {
    canAddTask: role === "Admin" || hasExactlyOneTaskCommittee,
    canRename: canMutatePhase,
    canRemove: canMutatePhase,
    queuesPhaseAction: editablePhase?.origin === "persisted",
  };
}

type TaskPayloadDraft = {
  title: string;
  description: string;
  committeeId: string;
  taskType: "Deliverable" | "LiveOperation";
  dueDate: string;
  callDate: string;
  callTime: string;
  endDate: string;
  endTime: string;
  priority: "Low" | "Medium" | "High" | "Critical";
  assigneeIds: string[];
};

export function getLiveOperationScheduleProblem(
  task: Pick<
    TaskPayloadDraft,
    "taskType" | "callDate" | "callTime" | "endDate" | "endTime"
  >,
) {
  if (task.taskType !== "LiveOperation") return null;

  if ((task.callDate || task.callTime || task.endDate || task.endTime) && !task.callDate) {
    return {
      field: "call-date",
      message: "Choose a Duty date when adding a Live Operation schedule.",
    } as const;
  }

  if ((task.callDate || task.callTime || task.endDate || task.endTime) && !task.callTime) {
    return {
      field: "call-time",
      message: "Choose a Call time when adding a Live Operation schedule.",
    } as const;
  }

  if (task.endDate && !task.endTime) {
    return {
      field: "end-time",
      message: "Choose an end time when setting an end date.",
    } as const;
  }

  if (task.endDate && task.callDate && task.endDate < task.callDate) {
    return {
      field: "end-date",
      message: "End date cannot be before the duty date.",
    } as const;
  }

  if (
    task.callDate &&
    task.callTime &&
    task.endTime &&
    (task.endDate || task.callDate) === task.callDate &&
    task.endTime < task.callTime
  ) {
    return {
      field: "end-time",
      message: "End time cannot be before call time.",
    } as const;
  }

  return null;
}

export function parseImportedDueDate(value: string | null) {
  return splitAppTimestamp(value);
}

export function getEventTaskDueDateForSubmission(
  task: Pick<TaskPayloadDraft, "taskType" | "dueDate">,
  storedDueDate: string | null = null,
) {
  return task.taskType === "LiveOperation" ? storedDueDate ?? "" : task.dueDate;
}

export function toTaskPayload(
  phaseName: string,
  task: TaskPayloadDraft,
  storedDueDate: string | null = null,
) {
  const submittedDueDate = getEventTaskDueDateForSubmission(task, storedDueDate);
  return {
    title: task.title,
    description: task.description || null,
    phase: phaseName.trim(),
    committee_id: task.committeeId,
    task_type: task.taskType,
    due_date: submittedDueDate || null,
    call_time:
      task.taskType === "LiveOperation"
        ? toAppTimestamp(task.callDate, task.callTime)
        : null,
    end_time:
      task.taskType === "LiveOperation"
        ? toAppTimestamp(task.endDate || task.callDate, task.endTime)
        : null,
    priority: task.priority,
    assignee_ids: task.assigneeIds,
  };
}

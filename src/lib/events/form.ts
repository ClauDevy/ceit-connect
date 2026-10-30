import { splitAppTimestamp, toAppTimestamp } from "../timezone";

export type EventFormPhaseOrigin = "persisted" | "local" | "reader-shell";

export type EventFormTaskRef = {
  id: string;
  persisted: boolean;
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
};

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
  const canMutatePhase =
    editablePhase !== null &&
    !phase.isReaderShell &&
    !coAdminDraftActionsBlocked;

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

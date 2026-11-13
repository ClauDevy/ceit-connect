export type PhaseCompletionReaderState = {
  phaseComplete: boolean;
  canReopen: boolean;
  reopenUpdatedAt: string | null;
};

type PhaseCompletionFieldNames = {
  phaseComplete: string;
  canReopen: string;
  updatedAt: string;
};

const BOARD_FIELDS: PhaseCompletionFieldNames = {
  phaseComplete: "phase_complete",
  canReopen: "can_reopen",
  updatedAt: "updated_at",
};

const DRAFT_FIELDS: PhaseCompletionFieldNames = {
  phaseComplete: "out_phase_complete",
  canReopen: "out_can_reopen",
  updatedAt: "out_updated_at",
};

function hasOwn(row: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function parseReaderState(
  value: unknown,
  fields: PhaseCompletionFieldNames,
): PhaseCompletionReaderState {
  const fallback = {
    phaseComplete: false,
    canReopen: false,
    reopenUpdatedAt: null,
  } satisfies PhaseCompletionReaderState;
  if (!value || typeof value !== "object") return fallback;
  const row = value as Record<string, unknown>;

  const phaseComplete = hasOwn(row, fields.phaseComplete)
    ? row[fields.phaseComplete]
    : false;
  const canReopen = hasOwn(row, fields.canReopen)
    ? row[fields.canReopen]
    : false;
  const updatedAt = hasOwn(row, fields.updatedAt) ? row[fields.updatedAt] : null;

  if (
    typeof phaseComplete !== "boolean" ||
    typeof canReopen !== "boolean" ||
    (typeof updatedAt !== "string" && updatedAt !== null)
  ) {
    return fallback;
  }

  if (!phaseComplete && canReopen) return fallback;
  if (canReopen !== (updatedAt !== null)) return fallback;

  return {
    phaseComplete,
    canReopen,
    reopenUpdatedAt: updatedAt,
  };
}

export function parseBoardPhaseCompletionState(value: unknown) {
  return parseReaderState(value, BOARD_FIELDS);
}

export function parseDraftPhaseCompletionState(value: unknown) {
  return parseReaderState(value, DRAFT_FIELDS);
}

export function parseTaskDetailPhaseComplete(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const phaseComplete = hasOwn(row, "phase_complete")
    ? row.phase_complete
    : false;
  return typeof phaseComplete === "boolean" ? phaseComplete : false;
}

export function canonicalPhaseName(phase: string | null | undefined) {
  const normalized = phase?.trim();
  return normalized ? normalized : "Unphased";
}

export function isCompletedNamedPhase(
  phase: string | null | undefined,
  phaseComplete: boolean,
) {
  return phaseComplete && canonicalPhaseName(phase) !== "Unphased";
}

export type ReopenCandidate = {
  id: string;
  title: string;
  phase: string;
  updatedAt: string;
};

export function getEffectiveReopenCandidate(
  candidates: readonly ReopenCandidate[],
  selectedId: string,
): ReopenCandidate | null {
  return candidates.find((candidate) => candidate.id === selectedId) ??
    candidates[0] ?? null;
}

export function getReopenCandidates(
  tasks: readonly {
    id: string;
    title: string;
    phase: string | null;
    phaseComplete: boolean;
    canReopen: boolean;
    reopenUpdatedAt: string | null;
    isMasked?: boolean;
  }[],
  phase: string,
): ReopenCandidate[] {
  return tasks.flatMap((task) =>
    !task.isMasked &&
    isCompletedNamedPhase(task.phase, task.phaseComplete) &&
    canonicalPhaseName(task.phase) === phase &&
    task.canReopen &&
    task.reopenUpdatedAt !== null
      ? [{
          id: task.id,
          title: task.title,
          phase,
          updatedAt: task.reopenUpdatedAt,
        }]
      : [],
  );
}

export type PhaseDisclosureState = {
  activePhase: string | null;
  collapsedPhases: ReadonlySet<string>;
  completedPhases: ReadonlySet<string>;
  focusPhase: string | null;
};

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function initializePhaseDisclosure(
  phases: readonly string[],
  completedPhases: ReadonlySet<string>,
): PhaseDisclosureState {
  const completed = new Set(
    phases.filter((phase) => completedPhases.has(phase) && phase !== "Unphased"),
  );
  return {
    activePhase:
      phases.find((phase) => !completed.has(phase)) ?? phases[0] ?? null,
    collapsedPhases: new Set(completed),
    completedPhases: completed,
    focusPhase: null,
  };
}

export function reconcilePhaseDisclosureAfterRefresh(
  previous: PhaseDisclosureState,
  phases: readonly string[],
  completedPhases: ReadonlySet<string>,
): PhaseDisclosureState {
  const completed = new Set(
    phases.filter((phase) => completedPhases.has(phase) && phase !== "Unphased"),
  );
  const collapsed = new Set(
    [...previous.collapsedPhases].filter((phase) => completed.has(phase)),
  );
  for (const phase of completed) {
    if (!previous.completedPhases.has(phase)) collapsed.add(phase);
  }
  const activePhase = previous.activePhase && phases.includes(previous.activePhase)
    ? previous.activePhase
    : (phases[0] ?? null);
  if (
    activePhase === previous.activePhase &&
    previous.focusPhase === null &&
    setsEqual(collapsed, previous.collapsedPhases) &&
    setsEqual(completed, previous.completedPhases)
  ) {
    return previous;
  }
  return {
    activePhase,
    collapsedPhases: collapsed,
    completedPhases: completed,
    focusPhase: null,
  };
}

export function selectPhaseDisclosure(
  previous: PhaseDisclosureState,
  phase: string,
): PhaseDisclosureState {
  if (previous.activePhase === phase && previous.focusPhase === null) return previous;
  return { ...previous, activePhase: phase, focusPhase: null };
}

export function setPhaseDisclosureExpanded(
  previous: PhaseDisclosureState,
  phase: string,
  expanded: boolean,
): PhaseDisclosureState {
  const collapsed = new Set(previous.collapsedPhases);
  if (expanded) collapsed.delete(phase);
  else if (previous.completedPhases.has(phase)) collapsed.add(phase);
  if (setsEqual(collapsed, previous.collapsedPhases)) return previous;
  return { ...previous, collapsedPhases: collapsed, focusPhase: null };
}

export function revealReopenedPhase(
  previous: PhaseDisclosureState,
  phase: string,
): PhaseDisclosureState {
  const collapsed = new Set(previous.collapsedPhases);
  const completed = new Set(previous.completedPhases);
  collapsed.delete(phase);
  completed.delete(phase);
  return {
    activePhase: phase,
    collapsedPhases: collapsed,
    completedPhases: completed,
    focusPhase: phase,
  };
}

export function applySuccessfulReopenState<
  T extends { id: string; phase: string | null; status: string; phaseComplete: boolean },
>(tasks: readonly T[], candidate: ReopenCandidate) {
  return tasks.map((task) =>
    canonicalPhaseName(task.phase) === candidate.phase
      ? {
          ...task,
          phaseComplete: false,
          status: task.id === candidate.id ? "In Progress" : task.status,
        }
      : task,
  );
}

export const PHASE_COMPLETION_ERROR_MESSAGES = {
  CCQ01:
    "This phase is complete and read-only. The latest state has been loaded.",
  CCQ02: "Archived tasks are read-only. The latest state has been loaded.",
  CCQ03: "This task cannot be reopened.",
  CCQ04: "Archived phases cannot be reopened.",
  CCQ05:
    "This task changed after it was loaded. The latest state has been loaded; choose a task and try again.",
  CCQ06:
    "Only a completed task can reopen this phase. The latest state has been loaded.",
  CCQ07:
    "This phase is no longer complete. The latest state has been loaded.",
  "40001":
    "The task or phase changed while saving. The latest state has been loaded; try again.",
  "40P01":
    "The task or phase is busy. The latest state has been loaded; try again.",
} as const;

export type PhaseCompletionErrorCode =
  keyof typeof PHASE_COMPLETION_ERROR_MESSAGES;

export const PHASE_COMPLETION_STATE_REFRESH_CODES = [
  "CCQ01", "CCQ05", "CCQ06", "CCQ07", "40001", "40P01",
] as const satisfies readonly PhaseCompletionErrorCode[];

export const PHASE_COMPLETION_LIFECYCLE_REFRESH_CODES = [
  "CCQ02", "CCQ04",
] as const satisfies readonly PhaseCompletionErrorCode[];

export const PHASE_COMPLETION_REFRESH_MESSAGES = new Set(
  [...PHASE_COMPLETION_STATE_REFRESH_CODES, ...PHASE_COMPLETION_LIFECYCLE_REFRESH_CODES]
    .map((code) => PHASE_COMPLETION_ERROR_MESSAGES[code]),
);

export function getPhaseCompletionErrorCode(
  error: unknown,
): PhaseCompletionErrorCode | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = error.code;
  if (typeof code !== "string") return null;
  return Object.prototype.hasOwnProperty.call(
    PHASE_COMPLETION_ERROR_MESSAGES,
    code,
  )
    ? (code as PhaseCompletionErrorCode)
    : null;
}

export function getPhaseCompletionErrorMessage(error: unknown) {
  const code = getPhaseCompletionErrorCode(error);
  return code === null ? null : PHASE_COMPLETION_ERROR_MESSAGES[code];
}

export function shouldRefetchAfterPhaseCompletionError(error: unknown) {
  const code = getPhaseCompletionErrorCode(error);
  return code !== null && (
    PHASE_COMPLETION_STATE_REFRESH_CODES.includes(code as never) ||
    PHASE_COMPLETION_LIFECYCLE_REFRESH_CODES.includes(code as never)
  );
}

export function shouldRefreshForFixedPhaseMessage(message: string) {
  return PHASE_COMPLETION_REFRESH_MESSAGES.has(message as never);
}

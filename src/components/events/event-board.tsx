"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type TransitionEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  Filter,
  Inbox,
  RefreshCw,
  X,
} from "lucide-react";
import Link from "next/link";
import { EventBanner } from "@/components/events/event-banner";
import { EventBoardSkeleton } from "@/components/events/event-board-skeleton";
import {
  EventBoardTaskCard,
  SortableEventBoardTaskCard,
} from "@/components/events/event-board-task-card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  BOARD_PRIORITIES,
  BOARD_STATUSES,
  isBoardTask,
  type BoardCommittee,
  type BoardEvent,
  type BoardPriority,
  type BoardStatus,
  type BoardTask,
} from "@/lib/events/board";
import {
  applyOptimisticMove,
  captureTaskNeighbors,
  createDropMoveIntent,
  createStatusMoveIntent,
  createUndoEntry,
  createUndoIntent,
  getBoardRefetchInterval,
  getMovePermission,
  mapMoveError,
  undoReducer,
  type BoardViewer,
  type MoveIntent,
  type NeighborHints,
} from "@/lib/events/board-move";
import {
  getTaskBackupErrorMessage,
  isClaimTaskResult,
} from "@/lib/tasks/backup";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type EventBoardProps = {
  event: BoardEvent;
  viewer: BoardViewer;
  committees: BoardCommittee[];
  initialTasks?: BoardTask[];
};

const eventDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatEventDate(date: string) {
  return eventDateFormatter.format(new Date(`${date}T00:00:00Z`));
}

function formatEventDateRange(event: BoardEvent) {
  if (!event.end_date || event.end_date === event.start_date) {
    return formatEventDate(event.start_date);
  }
  return `${formatEventDate(event.start_date)} – ${formatEventDate(event.end_date)}`;
}

function formatTaskCount(count: number) {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}


function PriorityChoices({
  selected,
  onToggle,
}: {
  selected: Set<BoardPriority>;
  onToggle: (priority: BoardPriority) => void;
}) {
  return (
    <div className="space-y-3">
      <p className="font-display text-sm font-semibold">Filter by priority</p>
      <div className="grid grid-cols-2 gap-2">
        {BOARD_PRIORITIES.map((priority) => {
          const active = selected.has(priority);
          return (
            <Button
              key={priority}
              type="button"
              variant="outline"
              className={cn(
                "h-11 justify-between",
                active && "border-primary bg-primary/10 text-primary",
              )}
              aria-pressed={active}
              onClick={() => onToggle(priority)}
            >
              {priority}
              {active ? <Check aria-hidden /> : null}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

function BoardLaneDropZone({
  status,
  disabled,
  children,
}: {
  status: BoardStatus;
  disabled: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${status}`,
    disabled,
    data: { type: "lane", status },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-24 space-y-3 rounded-xl transition-colors",
        isOver && !disabled && "bg-primary/5 ring-2 ring-primary/30",
      )}
    >
      {children}
    </div>
  );
}

type MoveMutationVariables = {
  task: BoardTask;
  intent: MoveIntent;
  originalNeighbors: NeighborHints;
  undo: boolean;
};

type MoveMutationContext = {
  previousTasks: BoardTask[] | undefined;
};

function BoardContents({
  event,
  viewer,
  committees,
  initialTasks,
}: EventBoardProps) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const isAdmin = viewer.role === "Admin";
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [activePhase, setActivePhase] = useState<string | null>(null);
  const [selectedPriorities, setSelectedPriorities] = useState<
    Set<BoardPriority>
  >(() => new Set());
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [priorityPanelMounted, setPriorityPanelMounted] = useState(false);
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const [committeePanelMounted, setCommitteePanelMounted] = useState(false);
  const [committeeActiveIndex, setCommitteeActiveIndex] = useState(0);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [undoState, dispatchUndo] = useReducer(undoReducer, {
    entries: [],
    undoingTaskId: null,
  });
  const boardBusyRef = useRef(false);
  const priorityTriggerRef = useRef<HTMLButtonElement>(null);
  const priorityPanelRef = useRef<HTMLDivElement>(null);
  const priorityOverlayRef = useRef<HTMLButtonElement>(null);
  const priorityReturnFocusRef = useRef(true);
  const committeeTriggerRef = useRef<HTMLButtonElement>(null);
  const committeePanelRef = useRef<HTMLDivElement>(null);
  const committeeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const committeeReturnFocusRef = useRef(true);
  const backlogButtonRef = useRef<HTMLButtonElement>(null);
  const boardBusy = pendingTaskId !== null || reconciling;
  const queryKey = useMemo(
    () => ["event-board", event.id, committeeId] as const,
    [event.id, committeeId],
  );
  const eventQueryKey = useMemo(
    () => ["event-board", event.id] as const,
    [event.id],
  );

  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      let request = supabase.rpc("list_event_board_tasks", {
        p_event_id: event.id,
        p_committee_id: isAdmin ? committeeId : null,
      });
      request = request.abortSignal(signal);
      const { data, error } = await request;
      if (error) throw error;
      if (!Array.isArray(data) || !data.every(isBoardTask)) {
        throw new Error("The event board returned an invalid response.");
      }
      return data;
    },
    initialData: committeeId === null ? initialTasks : undefined,
    refetchOnWindowFocus: () => !boardBusyRef.current,
    refetchInterval: () => getBoardRefetchInterval(boardBusyRef.current),
    refetchIntervalInBackground: false,
  });

  const tasks = useMemo(() => query.data ?? [], [query.data]);
  const phases = useMemo(
    () =>
      Array.from(
        new Set(tasks.map((task) => task.phase?.trim() || "Unphased")),
      ),
    [tasks],
  );

  const selectedPhase =
    activePhase && phases.includes(activePhase)
      ? activePhase
      : (phases[0] ?? null);

  const matchesPriority = (task: BoardTask) =>
    selectedPriorities.size === 0 ||
    task.effective_priority === null ||
    selectedPriorities.has(task.effective_priority);

  const backlogTasks = tasks.filter(
    (task) => task.is_backlog && matchesPriority(task),
  );
  const selectedPhaseTasks = tasks.filter(
    (task) => (task.phase?.trim() || "Unphased") === selectedPhase,
  );
  const unassignedSelectedPhaseTasks = selectedPhaseTasks.filter(
    (task) => task.is_backlog,
  );
  const assignedPhaseTasks = tasks.filter(
    (task) =>
      !task.is_backlog &&
      (task.phase?.trim() || "Unphased") === selectedPhase &&
      matchesPriority(task),
  );
  const isUnfilteredSelectedPhase =
    committeeId === null &&
    selectedPriorities.size === 0;
  const isUnfilteredBacklogOnlyPhase =
    isUnfilteredSelectedPhase &&
    selectedPhaseTasks.length > 0 &&
    unassignedSelectedPhaseTasks.length === selectedPhaseTasks.length;
  const isUnfilteredMixedPhase =
    isUnfilteredSelectedPhase &&
    unassignedSelectedPhaseTasks.length > 0 &&
    unassignedSelectedPhaseTasks.length < selectedPhaseTasks.length;
  const completed = tasks.filter((task) => task.status === "Completed").length;
  const completion =
    tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100);
  const selectedPriorityLabel = BOARD_PRIORITIES.filter((priority) =>
    selectedPriorities.has(priority),
  ).join(", ");
  const priorityButtonLabel = selectedPriorityLabel
    ? selectedPriorityLabel.length > 24
      ? `Priority: ${selectedPriorities.size} selected`
      : `Priority: ${selectedPriorityLabel}`
    : "Priority";
  const committeeOptions = [
    { id: null, name: "All committees" },
    ...committees,
  ];
  const selectedCommitteeIndex = committeeOptions.findIndex(
    (committee) => committee.id === committeeId,
  );
  const committeeButtonLabel =
    committeeOptions[selectedCommitteeIndex]?.name ?? "All committees";
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const moveMutation = useMutation<
    { task_id: string; status: BoardStatus; sort_order: number },
    unknown,
    MoveMutationVariables,
    MoveMutationContext
  >({
    mutationFn: async ({ intent }) => {
      const { data, error } = await supabase.rpc("move_task", {
        p_task_id: intent.taskId,
        p_expected_phase: intent.phase,
        p_expected_status: intent.expectedStatus,
        p_destination_status: intent.destinationStatus,
        p_previous_neighbor_id: intent.previousNeighborId,
        p_next_neighbor_id: intent.nextNeighborId,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : null;
      if (
        !result ||
        typeof result !== "object" ||
        result.task_id !== intent.taskId ||
        result.status !== intent.destinationStatus ||
        typeof result.sort_order !== "number"
      ) {
        throw new Error("The task move returned an invalid response.");
      }
      return result;
    },
    onMutate: async ({ intent }) => {
      await queryClient.cancelQueries({ queryKey: eventQueryKey });
      const previousTasks = queryClient.getQueryData<BoardTask[]>(queryKey);
      queryClient.setQueryData<BoardTask[]>(queryKey, (current) =>
        current ? applyOptimisticMove(current, intent) : current,
      );
      return { previousTasks };
    },
    onError: (error, variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(queryKey, context.previousTasks);
      }
      const mapped = mapMoveError(error);
      setMoveError(
        variables.undo ? `Undo failed. ${mapped.message}` : mapped.message,
      );
      if (variables.undo) {
        dispatchUndo({ type: "undo-failure", taskId: variables.task.id });
      }
    },
    onSuccess: (_result, variables) => {
      setMoveError(null);
      if (variables.undo) {
        dispatchUndo({ type: "undo-success", taskId: variables.task.id });
        return;
      }
      dispatchUndo({
        type: "offer",
        entry: createUndoEntry(
          variables.task,
          variables.intent,
          variables.originalNeighbors,
          Date.now(),
        ),
      });
    },
    onSettled: async () => {
      // Keep both interval polling and focus refetch disabled until the
      // authoritative reader has reconciled the optimistic cache.
      setReconciling(true);
      try {
        await queryClient.invalidateQueries({
          queryKey: eventQueryKey,
          refetchType: "active",
        });
      } finally {
        boardBusyRef.current = false;
        setPendingTaskId(null);
        setReconciling(false);
      }
    },
  });

  useEffect(() => {
    const timers = undoState.entries.map((entry) =>
      window.setTimeout(() => {
        dispatchUndo({
          type: "expire",
          taskId: entry.taskId,
          expiresAt: entry.expiresAt,
        });
      }, Math.max(0, entry.expiresAt - Date.now())),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [undoState.entries]);

  useEffect(() => {
    if (!priorityOpen && !committeeOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const isPriorityOverlay = priorityOverlayRef.current?.contains(target) ?? false;
      if (
        priorityOpen &&
        !priorityPanelRef.current?.contains(target) &&
        !priorityTriggerRef.current?.contains(target)
      ) {
        closePriorityFilter(isPriorityOverlay);
      }
      if (
        committeeOpen &&
        !committeePanelRef.current?.contains(target) &&
        !committeeTriggerRef.current?.contains(target)
      ) {
        closeCommitteeFilter(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (committeeOpen) closeCommitteeFilter();
        else closePriorityFilter();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [priorityOpen, committeeOpen]);

  function openPriorityFilter() {
    committeeReturnFocusRef.current = false;
    if (committeeOpen) closeCommitteeFilter(false);
    setPriorityPanelMounted(true);
    requestAnimationFrame(() => setPriorityOpen(true));
  }

  function closePriorityFilter(returnFocus = true) {
    priorityReturnFocusRef.current = returnFocus;
    setPriorityOpen(false);
  }

  function handlePriorityPanelTransitionEnd(
    event: TransitionEvent<HTMLDivElement>,
  ) {
    if (
      event.target === event.currentTarget &&
      event.propertyName === "opacity" &&
      !priorityOpen
    ) {
      setPriorityPanelMounted(false);
      if (priorityReturnFocusRef.current) {
        priorityTriggerRef.current?.focus();
      }
    }
  }

  function openCommitteeFilter() {
    priorityReturnFocusRef.current = false;
    if (priorityOpen) closePriorityFilter(false);
    setCommitteeActiveIndex(Math.max(selectedCommitteeIndex, 0));
    setCommitteePanelMounted(true);
    requestAnimationFrame(() => {
      setCommitteeOpen(true);
      requestAnimationFrame(() => {
        committeeOptionRefs.current[
          Math.max(selectedCommitteeIndex, 0)
        ]?.focus();
      });
    });
  }

  function closeCommitteeFilter(returnFocus = true) {
    committeeReturnFocusRef.current = returnFocus;
    setCommitteeOpen(false);
  }

  function handleCommitteePanelTransitionEnd(
    event: TransitionEvent<HTMLDivElement>,
  ) {
    if (
      event.target === event.currentTarget &&
      event.propertyName === "opacity" &&
      !committeeOpen
    ) {
      setCommitteePanelMounted(false);
      if (committeeReturnFocusRef.current) {
        committeeTriggerRef.current?.focus();
      }
    }
  }

  function selectCommittee(id: string | null) {
    if (boardBusyRef.current) return;
    setCommitteeId(id);
    closeCommitteeFilter();
  }

  function handleCommitteeOptionKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const nextIndex =
        event.key === "ArrowDown"
          ? (index + 1) % committeeOptions.length
          : (index - 1 + committeeOptions.length) % committeeOptions.length;
      setCommitteeActiveIndex(nextIndex);
      committeeOptionRefs.current[nextIndex]?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectCommittee(committeeOptions[index].id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeCommitteeFilter();
    }
  }

  function togglePriority(priority: BoardPriority) {
    if (boardBusyRef.current) return;
    setSelectedPriorities((current) => {
      const next = new Set(current);
      if (next.has(priority)) next.delete(priority);
      else next.add(priority);
      return next;
    });
  }

  function submitMove(variables: MoveMutationVariables) {
    if (boardBusyRef.current) return;
    boardBusyRef.current = true;
    setPendingTaskId(variables.task.id);
    setMoveError(null);
    if (!variables.undo) {
      dispatchUndo({ type: "clear", taskId: variables.task.id });
    }
    moveMutation.mutate(variables);
  }

  async function handleClaim(task: BoardTask) {
    if (boardBusyRef.current) return;
    boardBusyRef.current = true;
    setPendingTaskId(task.id);
    setClaimingTaskId(task.id);
    setMoveError(null);

    try {
      const { data, error } = await supabase.rpc("claim_task", {
        p_task_id: task.id,
      });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : null;
      if (!result || data.length !== 1 || !isClaimTaskResult(result)) {
        throw new Error("The claim writer returned an invalid response.");
      }
    } catch (error) {
      setMoveError(getTaskBackupErrorMessage("claim", error));
    } finally {
      setReconciling(true);
      try {
        await queryClient.invalidateQueries({
          queryKey: eventQueryKey,
          refetchType: "active",
        });
      } finally {
        boardBusyRef.current = false;
        setPendingTaskId(null);
        setClaimingTaskId(null);
        setReconciling(false);
      }
    }
  }

  function handleStatusMove(task: BoardTask, destinationStatus: BoardStatus) {
    const permission = getMovePermission(task, viewer);
    if (permission === "none") return;
    const intent = createStatusMoveIntent(task, destinationStatus);
    if (!intent) return;
    submitMove({
      task,
      intent,
      originalNeighbors: captureTaskNeighbors(tasks, task.id) ?? {
        previousNeighborId: null,
        nextNeighborId: null,
      },
      undo: false,
    });
  }

  function handleDragStart(event: DragStartEvent) {
    if (boardBusyRef.current || committeeId !== null) return;
    setActiveTaskId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTaskId(null);
    if (!event.over || boardBusyRef.current || committeeId !== null) return;
    const taskId = String(event.active.id);
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const permission = getMovePermission(task, viewer);
    const overStatus = event.over.data.current?.status;
    if (!BOARD_STATUSES.includes(overStatus as BoardStatus)) return;
    const overTaskId =
      event.over.data.current?.type === "task" ? String(event.over.id) : null;
    const intent = createDropMoveIntent({
      tasks,
      taskId,
      destinationStatus: overStatus as BoardStatus,
      overTaskId,
      permission,
    });
    if (!intent) return;
    submitMove({
      task,
      intent,
      originalNeighbors: captureTaskNeighbors(tasks, task.id) ?? {
        previousNeighborId: null,
        nextNeighborId: null,
      },
      undo: false,
    });
  }

  function handleUndo(taskId: string) {
    const entry = undoState.entries.find((candidate) => candidate.taskId === taskId);
    if (!entry || boardBusyRef.current) return;
    if (Date.now() >= entry.expiresAt) {
      dispatchUndo({ type: "expire", taskId, expiresAt: entry.expiresAt });
      setMoveError("The Undo window expired. The board was refreshed.");
      void queryClient.invalidateQueries({ queryKey: eventQueryKey });
      return;
    }
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      dispatchUndo({ type: "undo-failure", taskId });
      setMoveError("Undo failed because the task is no longer on this board.");
      void queryClient.invalidateQueries({ queryKey: eventQueryKey });
      return;
    }
    dispatchUndo({ type: "undo-start", taskId });
    submitMove({
      task,
      intent: createUndoIntent(entry),
      originalNeighbors: {
        previousNeighborId: entry.previousNeighborId,
        nextNeighborId: entry.nextNeighborId,
      },
      undo: true,
    });
  }

  const activeDragTask = activeTaskId
    ? tasks.find((task) => task.id === activeTaskId) ?? null
    : null;

  return (
    <div className="space-y-7">
      <Link
        href="/home"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <ArrowLeft aria-hidden /> Home
      </Link>

      <section className="overflow-hidden rounded-3xl border bg-card">
        <div className="flex flex-col lg:flex-row">
          <div className="w-full px-5 pt-5 sm:px-8 sm:pt-8 lg:w-2/5 lg:shrink-0 lg:px-0 lg:pt-0">
            <div className="mx-auto w-full max-w-xl lg:max-w-none">
              <EventBanner
                src={event.banner_url}
                alt={`${event.name} banner`}
                className="aspect-video w-full"
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 items-start justify-between gap-4 p-5 sm:p-8">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <h1 className="min-w-0 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  {event.name}
                </h1>
                <Badge variant="outline">Active</Badge>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                {formatEventDateRange(event)}
              </p>
              {event.description ? (
                <p className="text-sm text-muted-foreground">
                  {event.description}
                </p>
              ) : null}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                {completed} of {formatTaskCount(tasks.length)} completed
              </p>
            </div>
            <div className="shrink-0">
              <div
                className="grid size-16 place-items-center rounded-full border-6 border-muted text-sm font-bold"
                aria-label={`${completion}% complete`}
              >
                {completion}%
              </div>
            </div>
          </div>
        </div>
      </section>

      {moveError ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>{moveError}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setMoveError(null)}
          >
            Dismiss
          </Button>
        </InlineAlert>
      ) : null}

      {query.error ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            The board could not refresh. The last successful result is still
            shown.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </InlineAlert>
      ) : null}

      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div
          className="flex w-full min-w-0 gap-8 overflow-x-auto border-b md:flex-1"
          role="tablist"
          aria-label="Event phases"
        >
          {phases.map((phase) => {
            const count = tasks.filter(
              (task) => (task.phase?.trim() || "Unphased") === phase,
            ).length;
            return (
              <button
                key={phase}
                type="button"
                role="tab"
                aria-selected={selectedPhase === phase}
                title={phase}
                className={cn(
                  "flex h-11 max-w-[75vw] shrink-0 items-center border-b-2 px-1 font-display text-base font-semibold whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:max-w-xs",
                  selectedPhase === phase
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground",
                )}
                disabled={boardBusy}
                onClick={() => setActivePhase(phase)}
              >
                <span className="flex min-w-0 items-center">
                  <span className="truncate">{phase}</span>
                  <span className="ml-2 shrink-0 rounded-full bg-muted px-2 py-0.5 font-sans text-xs font-normal text-muted-foreground">
                    {formatTaskCount(count)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div
        className="flex w-full min-w-0 items-center gap-2"
      >
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2",
            isAdmin ? "md:w-[30rem] md:flex-none" : "sm:max-w-sm",
          )}
        >
          <div className="relative min-w-0 flex-1">
          <Button
            ref={priorityTriggerRef}
            variant="outline"
            className="h-10 w-full min-w-0 justify-start px-3 text-sm"
            aria-haspopup="dialog"
            aria-expanded={priorityOpen}
            aria-controls="priority-filter-panel"
            aria-label={priorityButtonLabel}
            disabled={boardBusy}
            onClick={() =>
              priorityOpen ? closePriorityFilter() : openPriorityFilter()
            }
          >
            <Filter aria-hidden />
            <span className="min-w-0 flex-1 truncate text-left">
              {priorityButtonLabel}
            </span>
            <ChevronDown
              className={cn(
                "ml-auto transition-transform duration-150 motion-reduce:rotate-0 motion-reduce:transition-none",
                priorityOpen && "rotate-180",
              )}
              aria-hidden
            />
          </Button>
          {priorityPanelMounted ? (
            <>
              <button
                ref={priorityOverlayRef}
                type="button"
                className={cn(
                  "fixed inset-0 z-40 bg-black/40 transition-opacity duration-150 sm:hidden motion-reduce:duration-[120ms]",
                  priorityOpen ? "opacity-100" : "pointer-events-none opacity-0",
                )}
                aria-label="Close priority filter"
                onClick={() => closePriorityFilter()}
              />
              <div
                id="priority-filter-panel"
                ref={priorityPanelRef}
                role="dialog"
                aria-label="Priority filter"
                onTransitionEnd={handlePriorityPanelTransitionEnd}
                className={cn(
                  "absolute top-full left-0 z-50 mt-2 w-full min-w-[14rem] max-w-[calc(100vw-1rem)] rounded-2xl border bg-popover p-4 shadow-2xl transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-opacity motion-reduce:duration-[120ms] motion-reduce:transform-none",
                  priorityOpen
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-[0.98] opacity-0 motion-reduce:scale-100",
                )}
              >
                <PriorityChoices
                  selected={selectedPriorities}
                  onToggle={togglePriority}
                />
                <div className="mt-4 flex items-center justify-between gap-3">
                  {selectedPriorities.size > 0 ? (
                    <Button
                      variant="link"
                      className="h-11 px-0 lg:h-10"
                      onClick={() => setSelectedPriorities(new Set())}
                    >
                      Clear
                    </Button>
                  ) : (
                    <span />
                  )}
                  <Button
                    className="h-11 sm:hidden"
                    onClick={() => closePriorityFilter()}
                  >
                    Done
                  </Button>
                </div>
              </div>
            </>
          ) : null}
          </div>

          {isAdmin ? (
            <div className="relative min-w-0 flex-1">
            <Button
              ref={committeeTriggerRef}
              variant="outline"
              className="h-10 w-full min-w-0 justify-start px-3 text-sm"
              aria-haspopup="listbox"
              aria-expanded={committeeOpen}
              aria-controls="committee-filter-panel"
              aria-label={`Committee: ${committeeButtonLabel}`}
              disabled={boardBusy}
              onClick={() =>
                committeeOpen ? closeCommitteeFilter() : openCommitteeFilter()
              }
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {committeeButtonLabel}
              </span>
              <ChevronDown
                className={cn(
                  "ml-auto transition-transform duration-150 motion-reduce:rotate-0 motion-reduce:transition-none",
                  committeeOpen && "rotate-180",
                )}
                aria-hidden
              />
            </Button>
            {committeePanelMounted ? (
              <div
                id="committee-filter-panel"
                ref={committeePanelRef}
                role="listbox"
                aria-label="Committee filter"
                aria-activedescendant={`committee-filter-option-${committeeActiveIndex}`}
                onTransitionEnd={handleCommitteePanelTransitionEnd}
                className={cn(
                  "absolute top-full right-0 z-50 mt-2 w-full min-w-[14rem] max-w-[calc(100vw-1rem)] rounded-2xl border bg-popover p-2 shadow-2xl transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-opacity motion-reduce:duration-[120ms] motion-reduce:transform-none sm:right-auto sm:left-0",
                  committeeOpen
                    ? "scale-100 opacity-100"
                    : "pointer-events-none scale-[0.98] opacity-0 motion-reduce:scale-100",
                )}
              >
                <div className="max-h-60 space-y-1 overflow-y-auto overscroll-contain">
                  {committeeOptions.map((committee, index) => {
                    const selected = committee.id === committeeId;
                    return (
                      <Button
                        key={committee.id ?? "all"}
                        id={`committee-filter-option-${index}`}
                        ref={(element) => {
                          committeeOptionRefs.current[index] = element;
                        }}
                        type="button"
                        role="option"
                        variant="ghost"
                        className={cn(
                          "h-11 w-full justify-between px-3 text-left",
                          selected && "bg-primary/10 text-primary",
                        )}
                        aria-selected={selected}
                        onClick={() => selectCommittee(committee.id)}
                        onFocus={() => setCommitteeActiveIndex(index)}
                        onKeyDown={(event) =>
                          handleCommitteeOptionKeyDown(event, index)
                        }
                      >
                        <span className="min-w-0 truncate">{committee.name}</span>
                        {selected ? <Check aria-hidden /> : null}
                      </Button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            </div>
          ) : null}
        </div>

        <Button
          id="event-board-backlog-button"
          ref={backlogButtonRef}
          variant="outline"
          className="h-10 w-auto min-w-10 shrink-0 px-2.5 md:ml-auto"
          aria-label={`Open Backlog, ${formatTaskCount(backlogTasks.length)}`}
          onClick={() => setBacklogOpen(true)}
        >
          <Inbox aria-hidden />
          <span className="sr-only sm:not-sr-only">Backlog</span>
          <Badge variant="neutral" className="px-1.5">
            {backlogTasks.length}
          </Badge>
        </Button>
      </div>

      {committeeId !== null ? (
        <InlineAlert variant="info">
          Clear the committee filter to drag cards. Status controls remain
          available; drag ordering needs the complete lane so neighbor hints
          cannot skip hidden committees.
        </InlineAlert>
      ) : null}

      {query.isPending ? (
        <EventBoardSkeleton />
      ) : tasks.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="font-display font-semibold">No tasks are available</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try another committee filter or refresh the board.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {isUnfilteredBacklogOnlyPhase || isUnfilteredMixedPhase ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
            >
              <span>
                {isUnfilteredBacklogOnlyPhase ? (
                  <>
                    {formatTaskCount(selectedPhaseTasks.length)} in this phase{" "}
                    {selectedPhaseTasks.length === 1 ? "is" : "are"} unassigned.
                  </>
                ) : (
                  <>
                    {unassignedSelectedPhaseTasks.length} of{" "}
                    {formatTaskCount(selectedPhaseTasks.length)} unassigned.
                  </>
                )}
              </span>
              <Button
                variant="link"
                className="h-11 px-0 text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring sm:h-10"
                onClick={() => setBacklogOpen(true)}
              >
                Open Backlog
              </Button>
            </div>
          ) : null}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragCancel={() => setActiveTaskId(null)}
            onDragEnd={handleDragEnd}
          >
            <div className="grid gap-5 md:grid-cols-3">
              {BOARD_STATUSES.map((status) => {
                const laneTasks = assignedPhaseTasks.filter(
                  (task) => task.status === status,
                );
                return (
                  <section
                    key={status}
                    aria-labelledby={`lane-${status.replaceAll(" ", "-")}`}
                  >
                    <div className="mb-3.5 flex items-center gap-2 px-0.5">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          status === "To Do" && "bg-muted-foreground",
                          status === "In Progress" && "bg-primary",
                          status === "Completed" && "bg-emerald-500",
                        )}
                      />
                      <h2
                        id={`lane-${status.replaceAll(" ", "-")}`}
                        className="text-sm font-semibold tracking-wide uppercase"
                      >
                        {status}
                      </h2>
                      <span className="text-xs text-muted-foreground">
                        {laneTasks.length}
                      </span>
                    </div>
                    <SortableContext
                      items={laneTasks.map((task) => task.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <BoardLaneDropZone
                        status={status}
                        disabled={boardBusy || committeeId !== null}
                      >
                        {laneTasks.map((task) => {
                          const permission = getMovePermission(task, viewer);
                          return (
                            <SortableEventBoardTaskCard
                              key={task.id}
                              task={task}
                              permission={permission}
                              busy={boardBusy}
                              dragDisabled={
                                boardBusy ||
                                committeeId !== null ||
                                permission === "none"
                              }
                              onMoveStatus={handleStatusMove}
                            />
                          );
                        })}
                        {laneTasks.length === 0 ? (
                          <div className="rounded-xl border-2 border-dashed p-4 text-center text-xs text-muted-foreground">
                            {selectedPriorities.size > 0
                              ? "No tasks match this filter."
                              : "No tasks yet"}
                          </div>
                        ) : null}
                      </BoardLaneDropZone>
                    </SortableContext>
                  </section>
                );
              })}
            </div>
            <DragOverlay>
              {activeDragTask ? (
                <div className="w-80 max-w-[calc(100vw-2rem)]">
                  <EventBoardTaskCard task={activeDragTask} overlay />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        </>
      )}

      <Sheet open={backlogOpen} onOpenChange={setBacklogOpen}>
        <SheetContent
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-board-backlog-title"
          aria-describedby="event-board-backlog-description"
          finalFocus={backlogButtonRef}
          className="group flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border-t p-0 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:translate-y-full data-[ending-style]:opacity-0 data-[starting-style]:translate-y-full data-[starting-style]:opacity-0 data-[ending-style]:duration-200 data-[ending-style]:ease-in motion-reduce:transition-opacity motion-reduce:duration-[120ms] motion-reduce:data-[ending-style]:translate-y-0 motion-reduce:data-[starting-style]:translate-y-0 md:inset-y-0 md:right-0 md:left-auto md:h-dvh md:max-h-none md:w-96 md:rounded-none md:border-t-0 md:border-l md:data-[ending-style]:translate-x-full md:data-[ending-style]:translate-y-0 md:data-[starting-style]:translate-x-full md:data-[starting-style]:translate-y-0 motion-reduce:md:data-[ending-style]:translate-x-0 motion-reduce:md:data-[starting-style]:translate-x-0"
        >
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-popover px-5 py-4">
            <div className="min-w-0 flex-1">
              <SheetTitle
                id="event-board-backlog-title"
                className="not-sr-only font-display text-lg font-semibold"
              >
                Task Backlog
              </SheetTitle>
              <SheetDescription id="event-board-backlog-description" className="text-xs">
                Unassigned tasks · read only
              </SheetDescription>
            </div>
            <Badge variant="neutral" className="shrink-0 px-2">
              {formatTaskCount(backlogTasks.length)}
            </Badge>
            <SheetClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 sm:size-8"
                  aria-label="Close backlog"
                />
              }
            >
              <X aria-hidden />
            </SheetClose>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {backlogTasks.map((task, index) => (
              <div
                key={task.id}
                className={cn(
                  "transition-[opacity,transform] duration-200 ease-out group-data-[starting-style]:translate-y-2 group-data-[starting-style]:opacity-0 motion-reduce:transition-opacity motion-reduce:duration-[120ms] motion-reduce:delay-0 motion-reduce:group-data-[starting-style]:translate-y-0",
                  index === 1 && "delay-[30ms]",
                  index === 2 && "delay-[60ms]",
                  index === 3 && "delay-[90ms]",
                  index === 4 && "delay-[120ms]",
                  index === 5 && "delay-[150ms]",
                )}
              >
                <EventBoardTaskCard
                  task={task}
                  backlog
                  busy={boardBusy}
                  claimBusy={claimingTaskId === task.id}
                  onClaim={handleClaim}
                />
              </div>
            ))}
            {backlogTasks.length === 0 ? (
              <p className="rounded-xl border-2 border-dashed p-5 text-center text-sm text-muted-foreground">
                {selectedPriorities.size > 0
                  ? "No unassigned tasks match this filter."
                  : "No unassigned tasks."}
              </p>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <div
        className="fixed right-4 bottom-20 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 md:bottom-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {undoState.entries.map((entry) => (
          <div
            key={`${entry.taskId}-${entry.expiresAt}`}
            role="status"
            className="flex items-center justify-between gap-3 rounded-xl border bg-popover px-4 py-3 text-sm shadow-lg"
          >
            <span className="min-w-0 truncate">
              Moved to {entry.toStatus}
            </span>
            <Button
              type="button"
              variant="link"
              className="h-9 shrink-0 px-0"
              disabled={
                boardBusy || undoState.undoingTaskId === entry.taskId
              }
              onClick={() => handleUndo(entry.taskId)}
            >
              Undo
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EventBoard(props: EventBoardProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1 },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <BoardContents {...props} />
    </QueryClientProvider>
  );
}

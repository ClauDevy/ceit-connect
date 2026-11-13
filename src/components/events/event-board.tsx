"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useReducedMotionPreference } from "@/components/shared/motion";
import {
  BOARD_PRIORITIES,
  BOARD_STATUSES,
  parseBoardTask,
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
  finishBoardDragOperation,
  getBoardRefetchInterval,
  getMovePermission,
  mapMoveError,
  releaseBoardOperation,
  shouldCancelBoardDrag,
  tryAcquireBoardOperation,
  undoReducer,
  type BoardDragSnapshot,
} from "@/lib/events/board-move";
import {
  getActiveMobileLane,
  getAssignedPhaseTasks,
  toggleCollapsedLane,
} from "@/lib/events/mobile-board";
import {
  getTaskBackupErrorMessage,
  isClaimTaskResult,
} from "@/lib/tasks/backup";
import {
  canonicalPhaseName,
  getReopenCandidates,
  initializePhaseDisclosure,
  reconcilePhaseDisclosureAfterRefresh,
  revealReopenedPhase,
  selectPhaseDisclosure,
} from "@/lib/tasks/phase-completion";
import { createClient } from "@/lib/supabase/client";
import { EventBoardDialogs } from "./event-board-dialogs";
import { getBoardPhaseNames, getCompleteBoardPhases } from "./event-board-helpers";
import { EventBoardHeader } from "./event-board-header";
import { EventBoardLanes } from "./event-board-lanes";
import { EventBoardPhaseControls } from "./event-board-phase-controls";
import type {
  EventBoardProps,
  MoveMutationContext,
  MoveMutationVariables,
} from "./event-board-types";

function BoardContents({
  event,
  viewer,
  committees,
  initialTasks,
  autoArchiveWarning,
}: EventBoardProps) {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const isAdmin = viewer.role === "Admin";
  const [committeeId, setCommitteeId] = useState<string | null>(null);
  const [phaseDisclosure, setPhaseDisclosure] = useState(() => {
    const initialPhaseNames = getBoardPhaseNames(initialTasks ?? []);
    return initializePhaseDisclosure(
      initialPhaseNames,
      getCompleteBoardPhases(initialTasks ?? []),
    );
  });
  const [phaseMotionKey, setPhaseMotionKey] = useState(0);
  const [selectedPriorities, setSelectedPriorities] = useState<
    Set<BoardPriority>
  >(() => new Set());
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [committeeOpen, setCommitteeOpen] = useState(false);
  const [committeeActiveIndex, setCommitteeActiveIndex] = useState(0);
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [taskDialog, setTaskDialog] = useState<
    { mode: "add" } | { mode: "edit"; taskId: string } | null
  >(null);
  const [activeMobileStatus, setActiveMobileStatus] =
    useState<BoardStatus>("To Do");
  const [collapsedLanes, setCollapsedLanes] = useState<Set<BoardStatus>>(
    () => new Set(),
  );
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [dndContextKey, setDndContextKey] = useState(0);
  const [snapSuspended, setSnapSuspended] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [claimingTaskId, setClaimingTaskId] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [undoState, dispatchUndo] = useReducer(undoReducer, {
    entries: [],
    undoingTaskId: null,
  });
  const boardBusyRef = useRef(false);
  const dragSessionRef = useRef<BoardDragSnapshot | null>(null);
  const priorityTriggerRef = useRef<HTMLButtonElement>(null);
  const priorityPanelRef = useRef<HTMLDivElement>(null);
  const priorityOverlayRef = useRef<HTMLButtonElement>(null);
  const committeeTriggerRef = useRef<HTMLButtonElement>(null);
  const committeePanelRef = useRef<HTMLDivElement>(null);
  const committeeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const backlogButtonRef = useRef<HTMLButtonElement>(null);
  const mobileBoardRef = useRef<HTMLDivElement>(null);
  const laneRefs = useRef(new Map<BoardStatus, HTMLElement>());
  const laneIntersectionRatios = useRef(new Map<BoardStatus, number>());
  const phaseTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const previousCompletePhases = useRef(
    getCompleteBoardPhases(initialTasks ?? []),
  );
  const reducedMotion = useReducedMotionPreference();
  const boardBusy = pendingTaskId !== null || reconciling;
  const canAddTask = viewer.role === "Admin" || viewer.role === "Co-Admin";
  const queryKey = useMemo(
    () => ["event-board", event.id, committeeId] as const,
    [event.id, committeeId],
  );
  const eventQueryKey = useMemo(
    () => ["event-board", event.id] as const,
    [event.id],
  );

  const refetchBoardAfterTaskSettlement = useCallback(async () => {
    await queryClient.refetchQueries({
      queryKey: eventQueryKey,
      type: "active",
    });
  }, [eventQueryKey, queryClient]);

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
      if (!Array.isArray(data)) {
        throw new Error("The event board returned an invalid response.");
      }
      const parsed = data.map(parseBoardTask);
      if (parsed.some((task) => task === null)) {
        throw new Error("The event board returned an invalid response.");
      }
      return parsed as BoardTask[];
    },
    initialData: committeeId === null ? initialTasks : undefined,
    // Switching committee keeps the current cards on screen while the new list loads,
    // instead of flashing the skeleton.
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: () => !boardBusyRef.current,
    refetchInterval: () => getBoardRefetchInterval(boardBusyRef.current),
    refetchIntervalInBackground: false,
  });

  const tasks = useMemo(() => query.data ?? [], [query.data]);
  // While the previous committee's cards are still shown as placeholder data, the lane is
  // partial, so dragging stays off until the real list for this filter has loaded.
  const reorderBlocked = committeeId !== null || query.isPlaceholderData;
  const hasTasks = tasks.length > 0;
  const phases = useMemo(() => getBoardPhaseNames(tasks), [tasks]);
  const completePhases = useMemo(() => getCompleteBoardPhases(tasks), [tasks]);
  const currentPhaseDisclosure = reconcilePhaseDisclosureAfterRefresh(
    phaseDisclosure,
    phases,
    completePhases,
  );
  if (currentPhaseDisclosure !== phaseDisclosure) {
    setPhaseDisclosure(currentPhaseDisclosure);
  }
  const selectedPhase = currentPhaseDisclosure.activePhase;
  const selectedPhaseComplete = selectedPhase !== null && completePhases.has(selectedPhase);
  const selectedCompletePhaseCollapsed = selectedPhase !== null &&
    currentPhaseDisclosure.collapsedPhases.has(selectedPhase);
  const selectedReopenCandidates = useMemo(
    () => selectedPhase ? getReopenCandidates(tasks.map((task) => ({
      id: task.id,
      title: task.title,
      phase: task.phase,
      phaseComplete: task.phaseComplete,
      canReopen: task.canReopen,
      reopenUpdatedAt: task.reopenUpdatedAt,
      isMasked: task.is_masked,
    })), selectedPhase) : [],
    [selectedPhase, tasks],
  );

  function selectPhase(phase: string) {
    if (phase === selectedPhase) return;
    cancelActiveDrag();
    if (boardBusyRef.current) return;
    setPhaseDisclosure(selectPhaseDisclosure(currentPhaseDisclosure, phase));
    setPhaseMotionKey((current) => current + 1);
  }

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
  const assignedPhaseTasks = getAssignedPhaseTasks(
    tasks,
    selectedPhase,
    selectedPriorities,
  );
  const isUnfilteredSelectedPhase =
    committeeId === null && selectedPriorities.size === 0;
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
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const finishDragSession = useCallback(
    (remount = false, preserveLock = false) => {
      const hadActiveDrag = dragSessionRef.current !== null;
      dragSessionRef.current = null;
      finishBoardDragOperation(
        boardBusyRef,
        hadActiveDrag,
        preserveLock,
      );
      mobileBoardRef.current?.removeAttribute("data-dragging");
      setActiveTaskId(null);
      setSnapSuspended(false);
      if (remount) setDndContextKey((current) => current + 1);
    },
    [],
  );

  const cancelActiveDrag = useCallback(() => {
    if (!dragSessionRef.current) return;
    finishDragSession(true);
  }, [finishDragSession]);

  useEffect(() => {
    const previous = previousCompletePhases.current;
    const newlyComplete = [...completePhases].filter((phase) => !previous.has(phase));
    if (newlyComplete.length > 0) {
      cancelActiveDrag();
      for (const entry of undoState.entries) {
        const task = tasks.find((candidate) => candidate.id === entry.taskId);
        if (task && completePhases.has(canonicalPhaseName(task.phase))) {
          dispatchUndo({ type: "clear", taskId: entry.taskId });
        }
      }
      setTaskDialog((current) => {
        if (current?.mode !== "edit") return current;
        const task = tasks.find((candidate) => candidate.id === current.taskId);
        return task && completePhases.has(canonicalPhaseName(task.phase)) ? null : current;
      });
    }
    previousCompletePhases.current = new Set(completePhases);
  }, [cancelActiveDrag, completePhases, tasks, undoState.entries]);

  useEffect(() => {
    const root = mobileBoardRef.current;
    if (
      !root ||
      !hasTasks ||
      query.isPending ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const status = (entry.target as HTMLElement).dataset.laneStatus as
            BoardStatus | undefined;
          if (status && BOARD_STATUSES.includes(status)) {
            laneIntersectionRatios.current.set(status, entry.intersectionRatio);
          }
        }

        const rootRect = root.getBoundingClientRect();
        const rootCenter = rootRect.left + rootRect.width / 2;
        const candidates = BOARD_STATUSES.flatMap((status) => {
          const lane = laneRefs.current.get(status);
          if (!lane) return [];
          const rect = lane.getBoundingClientRect();
          return [
            {
              status,
              intersectionRatio:
                laneIntersectionRatios.current.get(status) ?? 0,
              centerDistance: Math.abs(rect.left + rect.width / 2 - rootCenter),
            },
          ];
        });
        setActiveMobileStatus((current) =>
          getActiveMobileLane(candidates, current),
        );
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );

    laneIntersectionRatios.current.clear();
    for (const lane of laneRefs.current.values()) observer.observe(lane);
    return () => observer.disconnect();
    // The board node is recreated when the phase changes (or the drag context resets),
    // so the observer has to be rebuilt too or "Column x of 3" stops updating.
  }, [hasTasks, query.isPending, selectedPhase, selectedPhaseComplete, dndContextKey]);

  useEffect(() => {
    const snapshot = dragSessionRef.current;
    if (
      snapshot &&
      shouldCancelBoardDrag({
        snapshot,
        tasks,
        viewer,
        dataUpdatedAt: query.dataUpdatedAt,
      })
    ) {
      cancelActiveDrag();
    }
  }, [cancelActiveDrag, query.dataUpdatedAt, tasks, viewer]);

  useEffect(() => {
    const boardNode = mobileBoardRef.current;
    const cancelForResize = () => cancelActiveDrag();
    const cancelForPageHide = () => cancelActiveDrag();
    const cancelForVisibility = () => {
      if (document.visibilityState !== "visible") cancelActiveDrag();
    };

    window.addEventListener("resize", cancelForResize);
    window.addEventListener("orientationchange", cancelForResize);
    window.addEventListener("pagehide", cancelForPageHide);
    document.addEventListener("visibilitychange", cancelForVisibility);
    return () => {
      window.removeEventListener("resize", cancelForResize);
      window.removeEventListener("orientationchange", cancelForResize);
      window.removeEventListener("pagehide", cancelForPageHide);
      document.removeEventListener("visibilitychange", cancelForVisibility);
      boardNode?.removeAttribute("data-dragging");
      dragSessionRef.current = null;
      boardBusyRef.current = false;
    };
  }, [cancelActiveDrag]);

  function toggleLane(status: BoardStatus) {
    cancelActiveDrag();
    if (boardBusyRef.current) return;
    setCollapsedLanes((current) => toggleCollapsedLane(current, status));
  }

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
    onError: async (error, variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(queryKey, context.previousTasks);
      }
      const mapped = mapMoveError(error);
      try {
        await queryClient.refetchQueries({ queryKey: eventQueryKey, type: "active" });
      } catch { /* fixed message still appears */ }
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
        releaseBoardOperation(boardBusyRef);
        setPendingTaskId(null);
        setReconciling(false);
      }
    },
  });

  useEffect(() => {
    const timers = undoState.entries.map((entry) =>
      window.setTimeout(
        () => {
          dispatchUndo({
            type: "expire",
            taskId: entry.taskId,
            expiresAt: entry.expiresAt,
          });
        },
        Math.max(0, entry.expiresAt - Date.now()),
      ),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [undoState.entries]);

  useEffect(() => {
    if (!priorityOpen && !committeeOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      const isPriorityOverlay =
        priorityOverlayRef.current?.contains(target) ?? false;
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
    if (committeeOpen) closeCommitteeFilter(false);
    setPriorityOpen(true);
  }

  function closePriorityFilter(returnFocus = true) {
    setPriorityOpen(false);
    if (returnFocus) priorityTriggerRef.current?.focus();
  }

  function openCommitteeFilter() {
    if (priorityOpen) closePriorityFilter(false);
    setCommitteeActiveIndex(Math.max(selectedCommitteeIndex, 0));
    setCommitteeOpen(true);
    requestAnimationFrame(() => {
      committeeOptionRefs.current[Math.max(selectedCommitteeIndex, 0)]?.focus();
    });
  }

  function closeCommitteeFilter(returnFocus = true) {
    setCommitteeOpen(false);
    if (returnFocus) committeeTriggerRef.current?.focus();
  }

  function selectCommittee(id: string | null) {
    cancelActiveDrag();
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
    cancelActiveDrag();
    if (boardBusyRef.current) return;
    setSelectedPriorities((current) => {
      const next = new Set(current);
      if (next.has(priority)) next.delete(priority);
      else next.add(priority);
      return next;
    });
  }

  function clearPriorities() {
    cancelActiveDrag();
    if (boardBusyRef.current) return;
    setSelectedPriorities(new Set());
  }

  function submitMove(
    variables: MoveMutationVariables,
    lockAlreadyHeld = false,
  ) {
    if (lockAlreadyHeld) {
      if (!boardBusyRef.current) return;
    } else if (!tryAcquireBoardOperation(boardBusyRef)) {
      return;
    }
    setPendingTaskId(variables.task.id);
    setMoveError(null);
    if (!variables.undo) {
      dispatchUndo({ type: "clear", taskId: variables.task.id });
    }
    moveMutation.mutate(variables);
  }

  async function handleClaim(task: BoardTask) {
    if (!tryAcquireBoardOperation(boardBusyRef)) return;
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
    const taskId = String(event.active.id);
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task || reorderBlocked) return;
    const permission = getMovePermission(task, viewer);
    if (permission === "none" || !tryAcquireBoardOperation(boardBusyRef))
      return;

    dragSessionRef.current = {
      taskId,
      phase: task.phase,
      status: task.status,
      permission,
      dataUpdatedAt: query.dataUpdatedAt,
    };
    mobileBoardRef.current?.setAttribute("data-dragging", "true");
    setSnapSuspended(true);
    setActiveTaskId(taskId);
    void queryClient.cancelQueries({ queryKey: eventQueryKey });
  }

  function handleDragEnd(event: DragEndEvent) {
    const snapshot = dragSessionRef.current;
    if (
      !snapshot ||
      snapshot.taskId !== String(event.active.id) ||
      !event.over ||
      reorderBlocked ||
      shouldCancelBoardDrag({
        snapshot,
        tasks,
        viewer,
        dataUpdatedAt: query.dataUpdatedAt,
      })
    ) {
      finishDragSession();
      return;
    }
    const taskId = String(event.active.id);
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) {
      finishDragSession();
      return;
    }
    const permission = getMovePermission(task, viewer);
    const overStatus = event.over.data.current?.status;
    if (!BOARD_STATUSES.includes(overStatus as BoardStatus)) {
      finishDragSession();
      return;
    }
    const overTaskId =
      event.over.data.current?.type === "task" ? String(event.over.id) : null;
    const appendToTail = collapsedLanes.has(overStatus as BoardStatus);
    const intent = createDropMoveIntent({
      tasks,
      taskId,
      destinationStatus: overStatus as BoardStatus,
      overTaskId,
      permission,
      appendToTail,
    });
    if (!intent) {
      finishDragSession();
      return;
    }
    finishDragSession(false, true);
    submitMove(
      {
        task,
        intent,
        originalNeighbors: captureTaskNeighbors(tasks, task.id) ?? {
          previousNeighborId: null,
          nextNeighborId: null,
        },
        undo: false,
      },
      true,
    );
  }

  function handleDragCancel() {
    finishDragSession();
  }

  function handleUndo(taskId: string) {
    const entry = undoState.entries.find(
      (candidate) => candidate.taskId === taskId,
    );
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
    ? (tasks.find((task) => task.id === activeTaskId) ?? null)
    : null;

  return (
    <div className="space-y-6">
      <EventBoardHeader
        event={event}
        viewer={viewer}
        autoArchiveWarning={autoArchiveWarning}
        completed={completed}
        taskCount={tasks.length}
        completion={completion}
        moveError={moveError}
        onDismissMoveError={() => setMoveError(null)}
        queryError={query.error}
        onRetry={() => void query.refetch()}
      />
      <EventBoardPhaseControls
        phases={phases}
        tasks={tasks}
        phaseTabRefs={phaseTabRefs}
        selectedPhase={selectedPhase}
        completePhases={completePhases}
        boardBusy={boardBusy}
        selectPhase={selectPhase}
        selectedPhaseComplete={selectedPhaseComplete}
        isUnfilteredSelectedPhase={isUnfilteredSelectedPhase}
        isAdmin={isAdmin}
        priorityTriggerRef={priorityTriggerRef}
        priorityOpen={priorityOpen}
        priorityButtonLabel={priorityButtonLabel}
        closePriorityFilter={closePriorityFilter}
        openPriorityFilter={openPriorityFilter}
        priorityOverlayRef={priorityOverlayRef}
        priorityPanelRef={priorityPanelRef}
        selectedPriorities={selectedPriorities}
        togglePriority={togglePriority}
        clearPriorities={clearPriorities}
        committeeTriggerRef={committeeTriggerRef}
        committeeOpen={committeeOpen}
        committeeButtonLabel={committeeButtonLabel}
        closeCommitteeFilter={closeCommitteeFilter}
        openCommitteeFilter={openCommitteeFilter}
        committeePanelRef={committeePanelRef}
        committeeActiveIndex={committeeActiveIndex}
        committeeOptions={committeeOptions}
        committeeId={committeeId}
        committeeOptionRefs={committeeOptionRefs}
        selectCommittee={selectCommittee}
        setCommitteeActiveIndex={setCommitteeActiveIndex}
        handleCommitteeOptionKeyDown={handleCommitteeOptionKeyDown}
        selectedReopenCandidates={selectedReopenCandidates}
        onRefreshReopen={async () => {
          await queryClient.refetchQueries({ queryKey: eventQueryKey, type: "active" });
          await queryClient.refetchQueries({
            predicate: ({ queryKey: key }) => ["draft-event-editor-tasks", "task-detail", "task-edit-controls", "task-work-links", "task-comments", "task-backup-state"].includes(String(key[0])),
            type: "active",
          });
          window.dispatchEvent(new Event("task-leave-requests:changed"));
        }}
        onReopened={(candidate) => {
          setPhaseDisclosure((current) =>
            revealReopenedPhase(current, candidate.phase));
          requestAnimationFrame(() => phaseTabRefs.current.get(candidate.phase)?.focus());
        }}
        canAddTask={canAddTask}
        setTaskDialog={setTaskDialog}
        backlogButtonRef={backlogButtonRef}
        backlogCount={backlogTasks.length}
        setBacklogOpen={setBacklogOpen}
      />
      <EventBoardLanes
        queryPending={query.isPending}
        queryPlaceholder={query.isPlaceholderData}
        tasks={tasks}
        phaseMotionKey={phaseMotionKey}
        isUnfilteredBacklogOnlyPhase={isUnfilteredBacklogOnlyPhase}
        isUnfilteredMixedPhase={isUnfilteredMixedPhase}
        selectedPhaseTasks={selectedPhaseTasks}
        unassignedSelectedPhaseTasks={unassignedSelectedPhaseTasks}
        setBacklogOpen={setBacklogOpen}
        selectedPhaseComplete={selectedPhaseComplete}
        selectedPhase={selectedPhase}
        selectedPriorities={selectedPriorities}
        selectedCompletePhaseCollapsed={selectedCompletePhaseCollapsed}
        setPhaseDisclosure={setPhaseDisclosure}
        phases={phases}
        completePhases={completePhases}
        matchesPriority={matchesPriority}
        dndContextKey={dndContextKey}
        sensors={sensors}
        handleDragStart={handleDragStart}
        handleDragCancel={handleDragCancel}
        handleDragEnd={handleDragEnd}
        mobileBoardRef={mobileBoardRef}
        snapSuspended={snapSuspended}
        assignedPhaseTasks={assignedPhaseTasks}
        collapsedLanes={collapsedLanes}
        laneRefs={laneRefs}
        boardBusy={boardBusy}
        reorderBlocked={reorderBlocked}
        toggleLane={toggleLane}
        activeTaskId={activeTaskId}
        viewer={viewer}
        handleStatusMove={handleStatusMove}
        setTaskDialog={setTaskDialog}
        activeMobileStatus={activeMobileStatus}
        reducedMotion={reducedMotion}
        activeDragTask={activeDragTask}
      />
      <EventBoardDialogs
        backlogOpen={backlogOpen}
        setBacklogOpen={setBacklogOpen}
        backlogButtonRef={backlogButtonRef}
        backlogTasks={backlogTasks}
        boardBusy={boardBusy}
        claimingTaskId={claimingTaskId}
        handleClaim={handleClaim}
        viewer={viewer}
        selectedPriorities={selectedPriorities}
        taskDialog={taskDialog}
        setTaskDialog={setTaskDialog}
        event={event}
        selectedPhase={selectedPhase}
        completePhases={completePhases}
        phases={phases}
        committees={committees}
        refetchBoardAfterTaskSettlement={refetchBoardAfterTaskSettlement}
        undoState={undoState}
        handleUndo={handleUndo}
      />
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

"use client";

import type { Dispatch, RefObject, SetStateAction } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CheckCircle2, ChevronDown, Inbox } from "lucide-react";
import {
  EventBoardTaskCard,
  SortableEventBoardTaskCard,
} from "@/components/events/event-board-task-card";
import { EmptyState } from "@/components/shared/empty-state";
import { Mascot } from "@/components/ui/mascot";
import { Collapse, TabPanel } from "@/components/shared/motion";
import { EventBoardSkeleton } from "@/components/events/event-board-skeleton";
import { Button } from "@/components/ui/button";
import {
  BOARD_STATUSES,
  type BoardPriority,
  type BoardStatus,
  type BoardTask,
} from "@/lib/events/board";
import {
  getMovePermission,
  type BoardViewer,
} from "@/lib/events/board-move";
import { getMobileLanePosition } from "@/lib/events/mobile-board";
import { canShowBoardTaskEdit } from "@/lib/tasks/active-task-ui";
import {
  reconcilePhaseDisclosureAfterRefresh,
  setPhaseDisclosureExpanded,
  type PhaseDisclosureState,
} from "@/lib/tasks/phase-completion";
import { cn } from "@/lib/utils";
import { BoardLaneDropZone } from "./event-board-primitives";
import type { TaskDialogState } from "./event-board-types";
import { formatTaskCount } from "./event-board-helpers";

export function EventBoardLanes({
  queryPending,
  queryPlaceholder,
  tasks,
  phaseMotionKey,
  isUnfilteredBacklogOnlyPhase,
  isUnfilteredMixedPhase,
  selectedPhaseTasks,
  unassignedSelectedPhaseTasks,
  setBacklogOpen,
  selectedPhaseComplete,
  selectedPhase,
  selectedPriorities,
  selectedCompletePhaseCollapsed,
  setPhaseDisclosure,
  phases,
  completePhases,
  matchesPriority,
  dndContextKey,
  sensors,
  handleDragStart,
  handleDragCancel,
  handleDragEnd,
  mobileBoardRef,
  snapSuspended,
  assignedPhaseTasks,
  collapsedLanes,
  laneRefs,
  boardBusy,
  reorderBlocked,
  toggleLane,
  activeTaskId,
  viewer,
  handleStatusMove,
  setTaskDialog,
  activeMobileStatus,
  reducedMotion,
  activeDragTask,
}: {
  queryPending: boolean;
  queryPlaceholder: boolean;
  tasks: BoardTask[];
  phaseMotionKey: number;
  isUnfilteredBacklogOnlyPhase: boolean;
  isUnfilteredMixedPhase: boolean;
  selectedPhaseTasks: BoardTask[];
  unassignedSelectedPhaseTasks: BoardTask[];
  setBacklogOpen: (open: boolean) => void;
  selectedPhaseComplete: boolean;
  selectedPhase: string | null;
  selectedPriorities: ReadonlySet<BoardPriority>;
  selectedCompletePhaseCollapsed: boolean;
  setPhaseDisclosure: Dispatch<SetStateAction<PhaseDisclosureState>>;
  phases: string[];
  completePhases: Set<string>;
  matchesPriority: (task: BoardTask) => boolean;
  dndContextKey: number;
  sensors: ReturnType<typeof useSensors>;
  handleDragStart: (event: DragStartEvent) => void;
  handleDragCancel: () => void;
  handleDragEnd: (event: DragEndEvent) => void;
  mobileBoardRef: RefObject<HTMLDivElement | null>;
  snapSuspended: boolean;
  assignedPhaseTasks: BoardTask[];
  collapsedLanes: Set<BoardStatus>;
  laneRefs: RefObject<Map<BoardStatus, HTMLElement>>;
  boardBusy: boolean;
  reorderBlocked: boolean;
  toggleLane: (status: BoardStatus) => void;
  activeTaskId: string | null;
  viewer: BoardViewer;
  handleStatusMove: (task: BoardTask, destinationStatus: BoardStatus) => void;
  setTaskDialog: (value: TaskDialogState) => void;
  activeMobileStatus: BoardStatus;
  reducedMotion: boolean;
  activeDragTask: BoardTask | null;
}) {
  return queryPending ? (
    <EventBoardSkeleton />
  ) : tasks.length === 0 ? (
    <EmptyState
      pose="searching"
      title="No tasks are available"
      description="Try another committee filter or refresh the board."
    />
  ) : (
    <div className="motion-content-ready" aria-busy={queryPlaceholder}>
      <TabPanel motionKey={phaseMotionKey} opacityOnly>
        {isUnfilteredBacklogOnlyPhase || isUnfilteredMixedPhase ? (
          <div
            role="status"
            className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-900 dark:text-amber-100"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Inbox className="size-4 shrink-0" aria-hidden />
              <span>
                {isUnfilteredBacklogOnlyPhase ? (
                  <>
                    {formatTaskCount(selectedPhaseTasks.length)} in this phase{" "}
                    {selectedPhaseTasks.length === 1 ? "is" : "are"}{" "}
                    unassigned.
                  </>
                ) : (
                  <>
                    {unassignedSelectedPhaseTasks.length} of{" "}
                    {formatTaskCount(selectedPhaseTasks.length)} unassigned.
                  </>
                )}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              className="h-9 shrink-0 border-amber-500/50 bg-transparent px-3 text-xs font-semibold transition-colors duration-300 hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              onClick={() => setBacklogOpen(true)}
            >
              Open Backlog
            </Button>
          </div>
        ) : null}

        {selectedPhaseComplete ? (
          <div className="mb-3 flex flex-col items-center gap-0.5 text-center">
            <Mascot pose="celebrating" size={72} />
            <p className="text-sm font-semibold">Phase complete. Great work, team!</p>
          </div>
        ) : null}
        {selectedPhaseComplete ? (
          <section className="rounded-2xl border bg-card">
            <div className="flex items-center gap-3 border-b bg-muted/40 p-3">
              <CheckCircle2 className="size-5 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold line-through">{selectedPhase}</h2>
                <p className="text-xs text-muted-foreground">Complete · read only</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={!selectedCompletePhaseCollapsed}
                aria-controls="event-board-completed-phase-content"
                onClick={() => setPhaseDisclosure((current) =>
                  setPhaseDisclosureExpanded(
                    reconcilePhaseDisclosureAfterRefresh(
                      current,
                      phases,
                      completePhases,
                    ),
                    selectedPhase!,
                    selectedCompletePhaseCollapsed,
                  ))}
              >
                <ChevronDown className={cn("transition-transform motion-reduce:transition-none", selectedCompletePhaseCollapsed && "-rotate-90")} />
                {selectedCompletePhaseCollapsed ? "Expand" : "Collapse"}
              </Button>
            </div>
            <Collapse open={!selectedCompletePhaseCollapsed}>
              <div id="event-board-completed-phase-content" className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3">
                {selectedPhaseTasks.filter(matchesPriority).map((task) => <EventBoardTaskCard key={task.id} task={task} />)}
              </div>
            </Collapse>
          </section>
        ) : <DndContext
          key={dndContextKey}
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragAbort={handleDragCancel}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={mobileBoardRef}
            className={cn(
              "flex gap-4 overflow-x-auto overscroll-x-contain pb-2 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:pb-0 md:[scroll-snap-type:none]",
              snapSuspended ? "snap-none" : "snap-x snap-mandatory",
            )}
          >
            {BOARD_STATUSES.map((status) => {
              const laneTasks = assignedPhaseTasks.filter(
                (task) => task.status === status,
              );
              const collapsed = collapsedLanes.has(status);
              const laneId = `lane-${status.replaceAll(" ", "-")}`;
              const contentId = `${laneId}-content`;
              return (
                <section
                  key={status}
                  ref={(node) => {
                    if (node) laneRefs.current.set(status, node);
                    else laneRefs.current.delete(status);
                  }}
                  data-lane-status={status}
                  className="w-[calc(100%-1.5rem)] shrink-0 snap-start md:w-auto md:min-w-0 md:shrink md:[scroll-snap-align:none]"
                  aria-labelledby={laneId}
                >
                  <div className="mb-3 flex min-h-11 items-center gap-2 rounded-xl bg-muted/50 py-0.5 pr-0.5 pl-3">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span
                        className={cn(
                          "size-2 rounded-full",
                          status === "To Do" && "bg-muted-foreground",
                          status === "In Progress" && "bg-primary",
                          status === "Completed" && "bg-emerald-500",
                        )}
                      />
                      <h2
                        id={laneId}
                        className="truncate text-sm font-semibold tracking-wide uppercase"
                      >
                        {status}
                      </h2>
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs leading-none text-muted-foreground">
                        {laneTasks.length}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-11 shrink-0 transition-colors duration-300 active:bg-muted motion-reduce:transition-none md:size-8 md:min-w-0"
                      aria-expanded={!collapsed}
                      aria-controls={contentId}
                      aria-label={`${collapsed ? "Expand" : "Collapse"} ${status}`}
                      onClick={() => toggleLane(status)}
                    >
                      <ChevronDown
                        className={cn("transition-transform duration-[var(--motion-interaction-duration)] motion-reduce:transition-none", collapsed && "-rotate-90")}
                        aria-hidden
                      />
                    </Button>
                  </div>
                  <SortableContext
                    items={laneTasks.map((task) => task.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <BoardLaneDropZone
                      id={contentId}
                      status={status}
                      collapsed={collapsed}
                      disabled={boardBusy || reorderBlocked}
                    >
                      <Collapse open={!collapsed}>
                        <div className="space-y-3">
                          {laneTasks.map((task) => {
                            const permission = getMovePermission(
                              task,
                              viewer,
                            );
                            return (
                              <SortableEventBoardTaskCard
                                key={task.id}
                                task={task}
                                permission={permission}
                                busy={boardBusy}
                                dragDisabled={
                                  boardBusy ||
                                  collapsed ||
                                  reorderBlocked ||
                                  permission === "none"
                                }
                                onMoveStatus={handleStatusMove}
                                canEdit={canShowBoardTaskEdit(viewer, task)}
                                onEdit={() =>
                                  setTaskDialog({
                                    mode: "edit",
                                    taskId: task.id,
                                  })
                                }
                              />
                            );
                          })}
                          {laneTasks.length === 0 ? (
                            <div className="grid min-h-16 place-items-center rounded-xl border-2 border-dashed px-3 py-2 text-center text-xs text-muted-foreground">
                              {selectedPriorities.size > 0
                                ? "No tasks match this filter."
                                : "No tasks yet"}
                            </div>
                          ) : null}
                        </div>
                      </Collapse>
                      {collapsed ? (
                        <div className="grid min-h-11 place-items-center rounded-xl border border-dashed px-3 py-1.5 text-center text-xs text-muted-foreground">
                          {activeTaskId
                            ? `Drop to move to ${status}`
                            : `${status} is collapsed`}
                        </div>
                      ) : null}
                    </BoardLaneDropZone>
                  </SortableContext>
                </section>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-center gap-3 md:hidden">
            <p
              className="text-xs font-medium text-muted-foreground"
              aria-live="polite"
            >
              Column {getMobileLanePosition(activeMobileStatus)} of{" "}
              {BOARD_STATUSES.length}
              <span aria-hidden="true"> · </span>
              {activeMobileStatus}
            </p>
            <ol className="flex items-center gap-1.5" aria-hidden="true">
              {BOARD_STATUSES.map((status) => (
                <li
                  key={status}
                  className={cn(
                    "h-1.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none",
                    status === activeMobileStatus
                      ? "w-6 bg-primary"
                      : "w-2 bg-muted-foreground/35",
                  )}
                />
              ))}
            </ol>
          </div>
          <DragOverlay
            dropAnimation={
              reducedMotion
                ? null
                : { duration: 400, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
            }
          >
            {activeDragTask ? (
              <div className="w-80 max-w-[calc(100vw-2rem)]">
                <EventBoardTaskCard task={activeDragTask} overlay />
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>}
      </TabPanel>
    </div>
  );
}

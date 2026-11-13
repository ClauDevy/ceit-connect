"use client";

import type {
  KeyboardEvent as ReactKeyboardEvent,
  RefObject,
} from "react";
import { Check, CheckCircle2, ChevronDown, Filter, Inbox, Plus } from "lucide-react";
import { MotionPresence } from "@/components/shared/motion";
import { CompletedPhaseReopenDialog } from "@/components/tasks/completed-phase-reopen-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import type {
  BoardPriority,
  BoardTask,
} from "@/lib/events/board";
import type { ReopenCandidate } from "@/lib/tasks/phase-completion";
import { cn } from "@/lib/utils";
import { formatTaskCount } from "./event-board-helpers";
import { PriorityChoices } from "./event-board-primitives";
import type { TaskDialogState } from "./event-board-types";

export function EventBoardPhaseControls({
  phases,
  tasks,
  phaseTabRefs,
  selectedPhase,
  completePhases,
  boardBusy,
  selectPhase,
  selectedPhaseComplete,
  isUnfilteredSelectedPhase,
  isAdmin,
  priorityTriggerRef,
  priorityOpen,
  priorityButtonLabel,
  closePriorityFilter,
  openPriorityFilter,
  priorityOverlayRef,
  priorityPanelRef,
  selectedPriorities,
  togglePriority,
  clearPriorities,
  committeeTriggerRef,
  committeeOpen,
  committeeButtonLabel,
  closeCommitteeFilter,
  openCommitteeFilter,
  committeePanelRef,
  committeeActiveIndex,
  committeeOptions,
  committeeId,
  committeeOptionRefs,
  selectCommittee,
  setCommitteeActiveIndex,
  handleCommitteeOptionKeyDown,
  selectedReopenCandidates,
  onRefreshReopen,
  onReopened,
  canAddTask,
  setTaskDialog,
  backlogButtonRef,
  backlogCount,
  setBacklogOpen,
}: {
  phases: string[];
  tasks: BoardTask[];
  phaseTabRefs: RefObject<Map<string, HTMLButtonElement>>;
  selectedPhase: string | null;
  completePhases: Set<string>;
  boardBusy: boolean;
  selectPhase: (phase: string) => void;
  selectedPhaseComplete: boolean;
  isUnfilteredSelectedPhase: boolean;
  isAdmin: boolean;
  priorityTriggerRef: RefObject<HTMLButtonElement | null>;
  priorityOpen: boolean;
  priorityButtonLabel: string;
  closePriorityFilter: (returnFocus?: boolean) => void;
  openPriorityFilter: () => void;
  priorityOverlayRef: RefObject<HTMLButtonElement | null>;
  priorityPanelRef: RefObject<HTMLDivElement | null>;
  selectedPriorities: Set<BoardPriority>;
  togglePriority: (priority: BoardPriority) => void;
  clearPriorities: () => void;
  committeeTriggerRef: RefObject<HTMLButtonElement | null>;
  committeeOpen: boolean;
  committeeButtonLabel: string;
  closeCommitteeFilter: (returnFocus?: boolean) => void;
  openCommitteeFilter: () => void;
  committeePanelRef: RefObject<HTMLDivElement | null>;
  committeeActiveIndex: number;
  committeeOptions: Array<{ id: string | null; name: string }>;
  committeeId: string | null;
  committeeOptionRefs: RefObject<Array<HTMLButtonElement | null>>;
  selectCommittee: (id: string | null) => void;
  setCommitteeActiveIndex: (index: number) => void;
  handleCommitteeOptionKeyDown: (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void;
  selectedReopenCandidates: ReopenCandidate[];
  onRefreshReopen: () => Promise<void>;
  onReopened: (candidate: ReopenCandidate) => void;
  canAddTask: boolean;
  setTaskDialog: (value: TaskDialogState) => void;
  backlogButtonRef: RefObject<HTMLButtonElement | null>;
  backlogCount: number;
  setBacklogOpen: (open: boolean) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div
          className="-mx-1 flex w-[calc(100%+0.5rem)] min-w-0 gap-6 overflow-x-auto border-b px-1 md:flex-1"
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
                ref={(node) => {
                  if (node) phaseTabRefs.current.set(phase, node);
                  else phaseTabRefs.current.delete(phase);
                }}
                type="button"
                role="tab"
                aria-selected={selectedPhase === phase}
                title={phase}
                className={cn(
                  "flex h-11 max-w-[75vw] shrink-0 items-center rounded-t-md border-b-2 px-1 font-display text-sm font-semibold whitespace-nowrap transition-colors duration-300 hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:bg-muted motion-reduce:transition-none sm:h-10 sm:max-w-xs sm:text-base",
                  selectedPhase === phase
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground",
                )}
                disabled={boardBusy}
                onClick={() => selectPhase(phase)}
              >
                <span className="flex min-w-0 items-center">
                  {completePhases.has(phase) ? <CheckCircle2 className="mr-1.5 size-4 shrink-0" aria-hidden /> : null}
                  <span className={cn("truncate", completePhases.has(phase) && "line-through")}>{phase}</span>
                  {completePhases.has(phase) ? <span className="sr-only"> complete</span> : null}
                  <span className="ml-1.5 shrink-0 font-sans text-xs font-normal text-muted-foreground">
                    {formatTaskCount(count)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid w-full min-w-0 grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        {!selectedPhaseComplete || !isUnfilteredSelectedPhase ? (
        <div
          className={cn(
            "col-span-2 grid gap-2 sm:flex sm:max-w-full sm:flex-wrap sm:items-center",
            isAdmin ? "grid-cols-2" : "grid-cols-1",
          )}
        >
          <div className="relative max-w-full">
            <Button
              ref={priorityTriggerRef}
              variant="outline"
              className="h-11 w-full max-w-full justify-start px-3 text-sm transition-colors duration-300 active:bg-muted motion-reduce:transition-none sm:h-10 sm:w-auto"
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
              <span className="min-w-0 max-w-44 truncate text-left">
                {selectedPriorities.size > 0
                  ? `Priority (${selectedPriorities.size})`
                  : "Priority"}
              </span>
              <ChevronDown
                className={cn(
                  "ml-auto transition-transform duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
                  priorityOpen && "rotate-180",
                )}
                aria-hidden
              />
            </Button>
            <MotionPresence open={priorityOpen}>
              <>
                <button
                  ref={priorityOverlayRef}
                  type="button"
                  className={cn("fixed inset-0 z-40 bg-black/40 sm:hidden")}
                  aria-label="Close priority filter"
                  onClick={() => closePriorityFilter()}
                />
                <div
                  id="priority-filter-panel"
                  ref={priorityPanelRef}
                  role="dialog"
                  aria-label="Priority filter"
                  className={cn(
                    "fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] flex-col overflow-hidden rounded-2xl border bg-popover p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:left-0 sm:mt-2 sm:block sm:max-h-none sm:w-72 sm:max-w-[calc(100vw-1rem)] sm:overflow-visible",
                  )}
                >
                  <PriorityChoices
                    selected={selectedPriorities}
                    onToggle={togglePriority}
                  />
                  <div className="mt-4 flex shrink-0 items-center justify-between gap-3">
                    {selectedPriorities.size > 0 ? (
                      <Button
                        variant="link"
                        className="h-11 px-0 lg:h-10"
                        onClick={clearPriorities}
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
            </MotionPresence>
          </div>

          {isAdmin ? (
            <div className="relative max-w-full">
              <Button
                ref={committeeTriggerRef}
                variant="outline"
                className="h-11 w-full max-w-full justify-start px-3 text-sm transition-colors duration-300 active:bg-muted motion-reduce:transition-none sm:h-10 sm:w-auto"
                aria-haspopup="listbox"
                aria-expanded={committeeOpen}
                aria-controls="committee-filter-panel"
                aria-label={`Committee: ${committeeButtonLabel}`}
                disabled={boardBusy}
                onClick={() =>
                  committeeOpen ? closeCommitteeFilter() : openCommitteeFilter()
                }
              >
                <span className="min-w-0 max-w-52 truncate text-left">
                  {committeeButtonLabel}
                </span>
                <ChevronDown
                  className={cn(
                    "ml-auto transition-transform duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
                    committeeOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              </Button>
              <MotionPresence open={committeeOpen}>
                <div
                  id="committee-filter-panel"
                  ref={committeePanelRef}
                  role="listbox"
                  aria-label="Committee filter"
                  aria-activedescendant={`committee-filter-option-${committeeActiveIndex}`}
                  className={cn(
                    "fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] flex-col overflow-hidden rounded-2xl border bg-popover p-2 shadow-2xl sm:absolute sm:inset-x-auto sm:top-full sm:bottom-auto sm:left-0 sm:mt-2 sm:block sm:max-h-none sm:w-72 sm:max-w-[calc(100vw-1rem)] sm:overflow-visible",
                  )}
                >
                  <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain sm:max-h-60">
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
                          <span className="min-w-0 truncate">
                            {committee.name}
                          </span>
                          {selected ? <Check aria-hidden /> : null}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              </MotionPresence>
            </div>
          ) : null}
        </div>
        ) : null}

        {selectedPhaseComplete ? (
          <CompletedPhaseReopenDialog
            key={selectedPhase}
            phase={selectedPhase!}
            candidates={selectedReopenCandidates}
            onRefresh={onRefreshReopen}
            onReopened={onReopened}
          />
        ) : null}

        {canAddTask && !selectedPhaseComplete ? (
          <Button
            type="button"
            className="h-11 w-full min-w-11 transition-colors duration-300 hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring active:bg-primary/80 motion-reduce:transition-none sm:ml-auto sm:h-10 sm:w-auto"
            disabled={boardBusy}
            onClick={() => setTaskDialog({ mode: "add" })}
          >
            <Plus aria-hidden /> Add Task
          </Button>
        ) : null}

        <Button
          id="event-board-backlog-button"
          ref={backlogButtonRef}
          variant="outline"
          className={cn(
            "h-11 w-full min-w-11 shrink-0 px-2.5 transition-colors duration-300 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:bg-muted motion-reduce:transition-none sm:h-10 sm:w-auto sm:min-w-10",
            !canAddTask && "col-span-2 sm:col-span-1 sm:ml-auto",
          )}
          aria-label={`Open Backlog, ${formatTaskCount(backlogCount)}`}
          onClick={() => setBacklogOpen(true)}
        >
          <Inbox aria-hidden />
          <span>Backlog</span>
          <Badge variant="neutral" className="px-1.5">
            {backlogCount}
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
    </>
  );
}

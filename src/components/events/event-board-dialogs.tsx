"use client";

import { closeModalAndWait } from "@/hooks/use-modal-history";

import type { Dispatch, RefObject, SetStateAction } from "react";
import { X } from "lucide-react";
import { EventBoardBacklogCard } from "@/components/events/event-board-backlog-card";
import { Mascot } from "@/components/ui/mascot";
import { ActiveTaskDialog } from "@/components/tasks/active-task-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type {
  BoardCommittee,
  BoardEvent,
  BoardPriority,
  BoardStatus,
  BoardTask,
} from "@/lib/events/board";
import type { BoardViewer } from "@/lib/events/board-move";
import { canShowBoardTaskEdit } from "@/lib/tasks/active-task-ui";
import { formatTaskCount } from "./event-board-helpers";
import type { TaskDialogState } from "./event-board-types";

type EventBoardDialogsProps = {
  backlogOpen: boolean;
  setBacklogOpen: Dispatch<SetStateAction<boolean>>;
  backlogButtonRef: RefObject<HTMLButtonElement | null>;
  backlogTasks: BoardTask[];
  tasks: BoardTask[];
  boardBusy: boolean;
  claimingTaskId: string | null;
  handleClaim: (task: BoardTask) => void;
  viewer: BoardViewer;
  selectedPriorities: ReadonlySet<BoardPriority>;
  taskDialog: TaskDialogState;
  setTaskDialog: Dispatch<SetStateAction<TaskDialogState>>;
  event: BoardEvent;
  selectedPhase: string | null;
  completePhases: Set<string>;
  phases: string[];
  committees: BoardCommittee[];
  refetchBoardAfterTaskSettlement: () => Promise<void>;
  undoState: {
    entries: Array<{
      taskId: string;
      expiresAt: number;
      toStatus: BoardStatus;
    }>;
    undoingTaskId: string | null;
  };
  handleUndo: (taskId: string) => void;
};

export function EventBoardDialogs({
  backlogOpen,
  setBacklogOpen,
  backlogButtonRef,
  backlogTasks,
  tasks,
  boardBusy,
  claimingTaskId,
  handleClaim,
  viewer,
  selectedPriorities,
  taskDialog,
  setTaskDialog,
  event,
  selectedPhase,
  completePhases,
  phases,
  committees,
  refetchBoardAfterTaskSettlement,
  undoState,
  handleUndo,
}: EventBoardDialogsProps) {
  return (
    <>
      <Sheet open={backlogOpen} onOpenChange={setBacklogOpen}>
        <SheetContent
          role="dialog"
          aria-modal="true"
          aria-labelledby="event-board-backlog-title"
          aria-describedby="event-board-backlog-description"
          finalFocus={backlogButtonRef}
          className="flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border-t p-0 md:inset-y-0 md:right-0 md:left-auto md:h-dvh md:max-h-none md:w-96 md:rounded-none md:border-t-0 md:border-l md:data-[ending-style]:translate-x-full md:data-[ending-style]:translate-y-0 md:data-[starting-style]:translate-x-full md:data-[starting-style]:translate-y-0 md:motion-reduce:data-[starting-style]:translate-x-0"
        >
          <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-popover px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <SheetTitle
                id="event-board-backlog-title"
                className="not-sr-only font-display text-base font-semibold sm:text-lg"
              >
                Task Backlog
              </SheetTitle>
              <SheetDescription
                id="event-board-backlog-description"
                className="text-xs"
              >
                Unassigned tasks
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
                  className="size-11 transition-colors duration-300 active:bg-muted motion-reduce:transition-none sm:size-8"
                  aria-label="Close backlog"
                />
              }
            >
              <X aria-hidden />
            </SheetClose>
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain bg-muted/30 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-4">
            {backlogTasks.map((task) => (
              <EventBoardBacklogCard
                key={task.id}
                task={task}
                busy={boardBusy}
                claimBusy={claimingTaskId === task.id}
                onClaim={handleClaim}
                canEdit={canShowBoardTaskEdit(viewer, task)}
                 onEdit={async () => {
                   await closeModalAndWait(() => setBacklogOpen(false));
                  setTaskDialog({ mode: "edit", taskId: task.id });
                }}
              />
            ))}
            {backlogTasks.length === 0 ? (
              <div className="flex flex-col items-center gap-1 px-4 py-8 text-center">
                <Mascot pose={selectedPriorities.size > 0 ? "searching" : "sleeping"} size={76} className="mb-1" />
                <p className="font-display font-semibold">
                  {selectedPriorities.size > 0 ? "Nothing matches this filter" : "Backlog is clear"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {selectedPriorities.size > 0
                    ? "No unassigned tasks match this filter."
                    : "No unassigned tasks."}
                </p>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      {taskDialog ? (
        <ActiveTaskDialog
          open
          onOpenChange={(open) => {
            if (!open) setTaskDialog(null);
          }}
          mode={taskDialog.mode}
          eventId={taskDialog.mode === "add" ? event.id : undefined}
          eventEndDate={event.end_date}
          taskId={taskDialog.mode === "edit" ? taskDialog.taskId : undefined}
          defaultPhase={selectedPhase}
          completedPhaseNames={[...completePhases]}
          phaseOptions={phases.filter((phase) => !completePhases.has(phase))}
          dependencyOptions={taskDialog.mode === "add" ? tasks.map((task) => ({ id: task.id, label: task.is_masked ? "Confidential Task" : task.title, status: task.status })) : []}
          viewer={viewer}
          committees={committees}
          onSettled={refetchBoardAfterTaskSettlement}
        />
      ) : null}

      <div
        className="fixed right-4 bottom-20 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2 md:bottom-4"
        aria-live="polite"
        aria-atomic="false"
      >
        {undoState.entries.map((entry) => (
          <div
            key={`${entry.taskId}-${entry.expiresAt}`}
            role="status"
            className="motion-toast-enter flex items-center justify-between gap-3 rounded-xl border bg-popover px-4 py-3 text-sm shadow-lg"
          >
            <span className="min-w-0 truncate">Moved to {entry.toStatus}</span>
            <Button
              type="button"
              variant="link"
              className="h-9 shrink-0 px-0"
              disabled={boardBusy || undoState.undoingTaskId === entry.taskId}
              onClick={() => handleUndo(entry.taskId)}
            >
              Undo
            </Button>
          </div>
        ))}
      </div>
    </>
  );
}

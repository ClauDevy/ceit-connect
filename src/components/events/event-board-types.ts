import type {
  BoardCommittee,
  BoardEvent,
  BoardTask,
} from "@/lib/events/board";
import type {
  BoardViewer,
  MoveIntent,
  NeighborHints,
} from "@/lib/events/board-move";
import type { EventAutoArchiveWarning } from "@/lib/events/auto-archive-warning";

export type EventBoardProps = {
  event: BoardEvent;
  viewer: BoardViewer;
  committees: BoardCommittee[];
  initialTasks?: BoardTask[];
  autoArchiveWarning: EventAutoArchiveWarning | null;
};

export type TaskDialogState =
  | { mode: "add" }
  | { mode: "edit"; taskId: string }
  | null;

export type MoveMutationVariables = {
  task: BoardTask;
  intent: MoveIntent;
  originalNeighbors: NeighborHints;
  undo: boolean;
};

export type MoveMutationContext = {
  previousTasks: BoardTask[] | undefined;
};

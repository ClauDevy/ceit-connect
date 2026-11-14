import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock3,
  ListChecks,
  Pencil,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { CompletedPhaseReopenDialog } from "@/components/tasks/completed-phase-reopen-dialog";
import { Collapse, TabPanel } from "@/components/shared/motion";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { TigerLogo } from "@/components/ui/tiger-logo";
import {
  getEventPhaseCardKey,
  getEventPhaseControls,
} from "@/lib/events/form";
import { SUCCESS_ANIMATION_NAME } from "@/lib/motion";
import type { Committee, Role } from "@/lib/types";
import { cn } from "@/lib/utils";
import type {
  DraftEditorTask,
  InitialEvent,
  PhaseDraft,
  TaskDraft,
  TaskStatus,
} from "@/components/events/event-form-types";

type PhaseView = {
  key: string;
  name: string;
  isReaderShell: boolean;
  editablePhases: PhaseDraft[];
  readOnlyTasks: DraftEditorTask[];
};

type EventFormTaskPhasesProps = {
  tabMotionKey: number;
  role: Extract<Role, "Admin" | "Co-Admin">;
  initialEvent?: InitialEvent;
  draftReaderPending: boolean;
  draftReaderError: boolean;
  completionNotice: string;
  phaseViews: PhaseView[];
  completedDraftViewPhases: ReadonlySet<string>;
  currentCompletedPhaseDisclosure: {
    collapsedPhases: ReadonlySet<string>;
  };
  taskCommittees: Committee[];
  readOnlyTasks: DraftEditorTask[];
  committees: Committee[];
  phaseRemovalWarnings: Record<string, string>;
  savedTaskId: string | null;
  newPhaseName: string;
  onToggleCompletedPhase: (
    phaseName: string,
    phaseCollapsed: boolean,
  ) => void;
  onTogglePhase: (phaseId: string) => void;
  onUpdatePhaseName: (phaseId: string, name: string) => void;
  onMovePhase: (phaseId: string, direction: -1 | 1) => void;
  onRefreshCompletedPhase: () => Promise<void>;
  onReopenedPhase: (phaseName: string) => void;
  onRequestRemovePhase: (phase: PhaseDraft) => void;
  onSavedTaskAnimationEnd: () => void;
  onOpenEditTask: (phaseId: string, task: TaskDraft) => void;
  removeTask: (phaseId: string, taskId: string) => void;
  onOpenNewTask: (phaseId: string | null, phaseName?: string) => void;
  onNewPhaseNameChange: (name: string) => void;
  onAddPhase: () => void;
};

export function EventFormTaskPhases({
  tabMotionKey,
  role,
  initialEvent,
  draftReaderPending,
  draftReaderError,
  completionNotice,
  phaseViews,
  completedDraftViewPhases,
  currentCompletedPhaseDisclosure,
  taskCommittees,
  readOnlyTasks,
  committees,
  phaseRemovalWarnings,
  savedTaskId,
  newPhaseName,
  onToggleCompletedPhase,
  onTogglePhase,
  onUpdatePhaseName,
  onMovePhase,
  onRefreshCompletedPhase,
  onReopenedPhase,
  onRequestRemovePhase,
  onSavedTaskAnimationEnd,
  onOpenEditTask,
  removeTask,
  onOpenNewTask,
  onNewPhaseNameChange,
  onAddPhase,
}: EventFormTaskPhasesProps) {
  return (
    <TabPanel
      motionKey={tabMotionKey}
      id="event-tasks-panel"
      className="grid gap-5"
    >
      <div className="flex items-start gap-3 rounded-xl border bg-gradient-to-r from-primary/10 via-muted/30 to-card p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <ListChecks aria-hidden className="size-5" />
        </span>
        <div>
          <h2 className="font-display font-semibold">Task setup</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Organize the work into phases and assign initial owners.
          </p>
        </div>
      </div>
      <InlineAlert variant="info">
        A phase with no tasks will not be saved. Add at least one task to every
        phase you want to keep.
      </InlineAlert>

      {role === "Co-Admin" && (
        <p className="text-sm text-muted-foreground">
          You can edit only your committee&apos;s tasks. Other committees&apos;
          Draft tasks appear as read-only cards.
        </p>
      )}

      {initialEvent?.status === "Draft" && draftReaderError ? (
        <InlineAlert>
          The read-only Draft overview could not be refreshed. Phase actions
          stay unavailable until it reloads.
        </InlineAlert>
      ) : null}
      {completionNotice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {completionNotice}
        </p>
      ) : null}

      {phaseViews.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed p-8 text-center">
          <TigerLogo size={40} className="motion-empty-breathe mx-auto shrink-0 opacity-70 grayscale" />
          <p className="mt-3 font-semibold">No phases yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add a phase, then place its tasks into the backlog.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {phaseViews.map((phaseView, phaseIndex) => {
            const phaseComplete = completedDraftViewPhases.has(phaseView.name);
            const editablePhase = phaseView.editablePhases[0] ?? null;
            const editableTasks = phaseComplete ? [] : phaseView.editablePhases.flatMap(
              (phase) => phase.tasks.map((task) => ({ phase, task })),
            );
            const phaseControls = getEventPhaseControls({
              role,
              isDraft: initialEvent?.status === "Draft",
              readerAvailable: !draftReaderPending && !draftReaderError,
              hasExactlyOneTaskCommittee: taskCommittees.length === 1,
              phase: phaseView,
              readOnlyTasks,
            });
            const phaseCollapsed = phaseComplete
              ? currentCompletedPhaseDisclosure.collapsedPhases.has(phaseView.name)
              : (editablePhase?.collapsed ?? false);
            const phaseContentId = `draft-phase-content-${phaseIndex}`;
            const reopenCandidates = phaseView.readOnlyTasks.flatMap((task) =>
              task.phaseComplete && task.canReopen && task.reopenUpdatedAt
                ? [{ id: task.out_task_id, title: task.out_title, phase: phaseView.name, updatedAt: task.reopenUpdatedAt }]
                : []);
            return (
              <section key={getEventPhaseCardKey(phaseView)} className="overflow-hidden rounded-2xl border bg-card">
                <div className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-muted/40 p-3 sm:flex-nowrap">
                  {editablePhase || phaseComplete ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={phaseCollapsed ? "Expand phase" : "Collapse phase"}
                      aria-expanded={!phaseCollapsed}
                      aria-controls={phaseContentId}
                      onClick={() => phaseComplete
                        ? onToggleCompletedPhase(phaseView.name, phaseCollapsed)
                        : onTogglePhase(editablePhase!.id)}
                    >
                      <ChevronDown
                        className={cn(
                          "transition-transform duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
                          phaseCollapsed && "-rotate-90",
                        )}
                      />
                    </Button>
                  ) : null}
                  {editablePhase && !phaseComplete ? (
                    <Input
                      aria-label="Phase name"
                      placeholder="Phase name (tap to rename)"
                      maxLength={100}
                      value={editablePhase.name}
                      disabled={!phaseControls.canRename}
                      onChange={(event) =>
                        onUpdatePhaseName(editablePhase.id, event.target.value)
                      }
                      className="order-first h-12 min-w-0 basis-full border-input bg-background px-3.5 text-base font-semibold shadow-none sm:order-none sm:h-11 sm:basis-0 sm:flex-1 md:h-8"
                    />
                  ) : (
                    <p className={cn("min-w-0 flex-1 truncate font-semibold", phaseComplete && "line-through")}>
                      {phaseComplete ? <CheckCircle2 className="mr-1 inline size-4" aria-hidden /> : null}{phaseView.name}
                      {phaseComplete ? <span className="sr-only"> complete</span> : null}
                    </p>
                  )}
                  <Badge variant="neutral">
                    {editableTasks.length + phaseView.readOnlyTasks.length} task
                    {editableTasks.length + phaseView.readOnlyTasks.length === 1 ? "" : "s"}
                  </Badge>
                  {editablePhase ? (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move ${phaseView.name} up`}
                        className={phaseIndex === 0 ? "invisible" : undefined}
                        tabIndex={phaseIndex === 0 ? -1 : undefined}
                        onClick={() => onMovePhase(editablePhase.id, -1)}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Move ${phaseView.name} down`}
                        className={phaseIndex === phaseViews.length - 1 ? "invisible" : undefined}
                        tabIndex={phaseIndex === phaseViews.length - 1 ? -1 : undefined}
                        onClick={() => onMovePhase(editablePhase.id, 1)}
                      >
                        <ArrowDown />
                      </Button>
                    </>
                  ) : null}
                  {phaseComplete ? (
                    <CompletedPhaseReopenDialog
                      phase={phaseView.name}
                      candidates={reopenCandidates}
                      onRefresh={onRefreshCompletedPhase}
                      onReopened={() => onReopenedPhase(phaseView.name)}
                    />
                  ) : editablePhase ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                      aria-label={`Remove ${phaseView.name}`}
                      disabled={!phaseControls.canRemove}
                      onClick={() => onRequestRemovePhase(editablePhase)}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </div>

                <Collapse open={!phaseCollapsed}>
                  <div id={phaseContentId} className="grid gap-3 p-3">
                    {editablePhase && phaseRemovalWarnings[editablePhase.id] ? (
                      <InlineAlert>{phaseRemovalWarnings[editablePhase.id]}</InlineAlert>
                    ) : null}
                    {phaseView.readOnlyTasks.length > 0 && !phaseComplete ? (
                      <p className="text-sm text-muted-foreground">
                        This phase includes read-only tasks from another committee. You can add tasks for your committee, but you can&apos;t rename or remove this phase.
                      </p>
                    ) : null}
                    {editableTasks.map(({ phase, task }) => {
                      const committee = committees.find((item) => item.id === task.committeeId);
                      return (
                        <div
                          key={task.id}
                          className={cn(
                            "flex flex-col gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between",
                            savedTaskId === task.id &&
                              "motion-success-enter outline-2 outline-primary/40",
                          )}
                          onAnimationEnd={(event) => {
                            if (
                              event.target === event.currentTarget &&
                              event.animationName === SUCCESS_ANIMATION_NAME
                            ) {
                              onSavedTaskAnimationEnd();
                            }
                          }}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-semibold">{task.title}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline">
                                {committee?.name ?? "Unknown committee"}
                              </Badge>
                              <span>
                                {task.taskType === "LiveOperation" ? "Live Operation" : "Deliverable"}
                              </span>
                              <PriorityBadge priority={task.priority} />
                              {task.persisted && <TaskStatusBadge status={task.status} />}
                              {!task.templateEditable && <Badge variant="neutral">Read only</Badge>}
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
                                  : "Unassigned (Backlog)"}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            {task.templateEditable ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Edit ${task.title}`}
                                onClick={() => onOpenEditTask(phase.id, task)}
                              >
                                <Pencil />
                              </Button>
                            ) : null}
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:text-destructive"
                              aria-label={`Remove ${task.title}`}
                              title={
                                task.status === "To Do"
                                  ? `Remove ${task.title}`
                                  : `${task.status} tasks cannot be deleted`
                              }
                              disabled={task.status !== "To Do"}
                              onClick={() => removeTask(phase.id, task.id)}
                            >
                              <Trash2 />
                            </Button>
                          </div>
                        </div>
                      );
                    })}

                    {phaseView.readOnlyTasks.map((task) => (
                      <div key={task.out_task_id} className="rounded-xl border bg-muted/30 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold">{task.out_title}</p>
                          <Badge variant="neutral">Read only</Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {task.out_committee_name ? <Badge variant="outline">{task.out_committee_name}</Badge> : null}
                          <TaskStatusBadge status={task.out_status} />
                          {task.out_is_masked ? <span>Confidential details are hidden.</span> : null}
                        </div>
                      </div>
                    ))}

                    {editableTasks.length === 0 && phaseView.readOnlyTasks.length === 0 && (
                      <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
                        This phase is empty and will not be saved.
                      </p>
                    )}

                    {!phaseComplete && !phaseControls.canAddTask && role === "Co-Admin" ? (
                      <p className="text-sm text-muted-foreground">
                        Add task is unavailable because your committee could not be verified.
                      </p>
                    ) : null}

                    {!phaseComplete ? <Button
                      type="button"
                      variant="outline"
                      className="w-full border-dashed"
                      disabled={!phaseControls.canAddTask}
                      onClick={() => onOpenNewTask(editablePhase?.id ?? null, phaseView.name)}
                    >
                      <Plus />
                      Add task
                    </Button> : null}
                  </div>
                </Collapse>
              </section>
            );
          })}
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-2xl border-2 border-dashed p-4 sm:flex-row">
        <Input
          aria-label="New phase name"
          maxLength={100}
          value={newPhaseName}
          onChange={(event) => onNewPhaseNameChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddPhase();
            }
          }}
          placeholder="e.g. Event Day"
        />
        <Button type="button" onClick={onAddPhase}>
          <Plus />
          Add phase
        </Button>
      </div>
    </TabPanel>
  );
}

function TaskStatusBadge({ status }: { status: TaskStatus }) {
  const Icon =
    status === "Completed"
      ? CheckCircle2
      : status === "In Progress"
        ? Clock3
        : Circle;
  return (
    <Badge variant="neutral">
      <Icon aria-hidden />
      {status}
    </Badge>
  );
}

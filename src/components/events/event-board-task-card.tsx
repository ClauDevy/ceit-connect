"use client";

import { formatDateSafe } from "@/lib/safe-date";
import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowRight,
  CalendarDays,
  Check,
  GripVertical,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
} from "lucide-react";
import { StretchedLink } from "@/components/shared/stretched-link";
import { PriorityBadge } from "@/components/shared/priority-badge";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardMeta, type CardAccent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BOARD_STATUSES,
  type BoardStatus,
  type BoardTask,
} from "@/lib/events/board";
import type { MovePermission } from "@/lib/events/board-move";
import { isClaimableBacklogTask } from "@/lib/tasks/backup";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

// An unreadable or odd date must never crash the board: it simply shows no chip.
function formatDueDate(value: string | null): string | null {
  return value ? formatDateSafe(dueDateFormatter, value, "") || null : null;
}

function TaskAssignees({ task }: { task: BoardTask }) {
  const assignees = [
    ...task.primary_assignees,
    ...task.assist_assignees,
  ].filter(
    (assignee, index, all) =>
      all.findIndex((candidate) => candidate.id === assignee.id) === index,
  );

  if (task.is_masked) {
    return (
      <LockKeyhole
        className="size-4 text-muted-foreground"
        aria-label="Confidential"
      />
    );
  }
  if (assignees.length === 0) return null;

  return (
    <div className="flex -space-x-1.5" aria-label="Assignees">
      {assignees.slice(0, 3).map((assignee) => {
        const name = assignee.full_name ?? "Former member";
        return (
          <UserAvatar
            key={assignee.id}
            name={name}
            src={assignee.avatar_url}
            size="sm"
            className="size-6 border-2 border-card text-[9px]"
          />
        );
      })}
      {assignees.length > 3 ? (
        <span className="z-10 inline-flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[9px] font-semibold">
          +{assignees.length - 3}
        </span>
      ) : null}
    </div>
  );
}

type CardBodyProps = {
  task: BoardTask;
  backlog?: boolean;
  permission?: MovePermission;
  busy?: boolean;
  overlay?: boolean;
  dragAttributes?: ReturnType<typeof useSortable>["attributes"];
  dragListeners?: ReturnType<typeof useSortable>["listeners"];
  onMoveStatus?: (task: BoardTask, status: BoardStatus) => void;
  claimBusy?: boolean;
  onClaim?: (task: BoardTask) => void;
  canEdit?: boolean;
  onEdit?: (task: BoardTask) => void;
};

function CardBody({
  task,
  backlog = false,
  permission = "none",
  busy = false,
  overlay = false,
  dragAttributes,
  dragListeners,
  onMoveStatus,
  claimBusy = false,
  onClaim,
  canEdit = false,
  onEdit,
}: CardBodyProps) {
  const showBacklogFooter =
    task.is_masked ||
    task.status === "Completed" ||
    (!task.is_masked && task.effective_priority !== null) ||
    task.due_date !== null ||
    task.primary_assignees.length > 0 ||
    task.assist_assignees.length > 0;
  const canMove = permission !== "none" && !task.is_masked && !overlay;
  const showMenu = !overlay && ((canEdit && Boolean(onEdit)) || canMove);
  const completed = task.status === "Completed" && !task.is_masked;
  const priority = !task.is_masked ? task.effective_priority : null;
  const dueLabel =
    !task.is_masked && !completed ? formatDueDate(task.due_date) : null;

  return (
    <Card
      accent={completed ? "success" : priority ? (priority.toLowerCase() as CardAccent) : "muted"}
      interactive={!overlay}
      className={cn(
        "relative p-0",
        completed
          ? "bg-priority-low-soft/20 opacity-70"
          : priority
            ? priorityTint[priority.toLowerCase() as keyof typeof priorityTint]
            : null,
        overlay &&
          "cursor-grabbing scale-[1.02] opacity-90 shadow-xl motion-reduce:scale-100 motion-reduce:transition-none",
      )}
    >
      {!overlay ? (
        <StretchedLink
          href={`/tasks/${task.id}`}
          label={`Open ${task.title}`}
          className="transition-colors duration-300 hover:bg-muted/40 active:bg-muted/60 motion-reduce:transition-none"
        />
      ) : null}
      <CardContent className="space-y-1.5 p-2.5 sm:p-3.5">
        <div className="flex items-start gap-2.5">
          <p
            className={cn(
              "min-w-0 flex-1 text-sm leading-snug font-semibold",
              "line-clamp-2",
              completed && "line-through decoration-muted-foreground",
            )}
          >
            {task.title}
          </p>

          <div className="relative z-20 -mr-1.5 flex shrink-0 items-center">
            {showMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="-my-2 h-11 w-9 rounded-full transition-colors duration-300 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:bg-muted motion-reduce:transition-none md:my-0 md:size-8"
                      aria-label={`Task actions for ${task.title}`}
                      aria-busy={busy}
                      onClick={(event) => event.stopPropagation()}
                    />
                  }
                >
                  <MoreHorizontal aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {canEdit && onEdit ? (
                    <DropdownMenuItem onClick={() => onEdit(task)}>
                      <Pencil aria-hidden /> Edit task
                    </DropdownMenuItem>
                  ) : null}
                  {canMove ? (
                    <>
                      <p className="px-2.5 pt-1.5 pb-1 text-xs font-medium text-muted-foreground">
                        Move to
                      </p>
                      {BOARD_STATUSES.map((status) => (
                        <DropdownMenuItem
                          key={status}
                          disabled={busy || status === task.status}
                          onClick={() => {
                            if (status !== task.status) onMoveStatus?.(task, status);
                          }}
                        >
                          {status === task.status ? (
                            <Check aria-hidden />
                          ) : (
                            <ArrowRight aria-hidden />
                          )}
                          {status}
                        </DropdownMenuItem>
                      ))}
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {dragAttributes && dragListeners ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="-my-2 h-11 w-8 cursor-grab touch-none select-none rounded-full text-muted-foreground transition-colors duration-300 [-webkit-touch-callout:none] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing active:bg-muted aria-pressed:cursor-grabbing aria-pressed:bg-muted motion-reduce:transition-none md:my-0 md:size-8"
                disabled={busy}
                {...dragAttributes}
                {...dragListeners}
                aria-label={`Drag ${task.title}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <GripVertical aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>

        {backlog && !task.is_masked ? (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate">
              {task.committee_name ?? "Committee unavailable"}
            </span>
            <span
              className="shrink-0 rounded-full bg-muted px-2 py-0.5"
              title={task.phase?.trim() || "Unphased"}
            >
              {task.phase?.trim() || "Unphased"}
            </span>
          </div>
        ) : null}

        {backlog && isClaimableBacklogTask(task) && onClaim ? (
          <Button
            type="button"
            className="relative z-20 w-full transition-colors duration-300 active:bg-primary/70 motion-reduce:transition-none"
            disabled={busy || claimBusy}
            onClick={() => onClaim(task)}
          >
            {claimBusy ? (
              <>
                <LoaderCircle
                  className="motion-safe:animate-spin"
                  aria-hidden
                />{" "}
                Claiming
              </>
            ) : (
              "Claim Task"
            )}
          </Button>
        ) : null}

        {!backlog || showBacklogFooter ? (
          <CardMeta className="min-h-6 justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {priority ? (
                <PriorityBadge
                  priority={priority}
                  className="px-2 py-0 text-[11px] leading-5"
                />
              ) : (
                <Badge variant="neutral" className="px-2 py-0 text-[11px]">
                  <LockKeyhole aria-hidden /> Confidential
                </Badge>
              )}
              {completed ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                  <Check className="size-3 text-emerald-600" aria-hidden />
                  Completed
                </span>
              ) : null}
              {dueLabel ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium">
                  <CalendarDays className="size-3" aria-hidden />
                  Due {dueLabel}
                </span>
              ) : null}
            </div>
            <TaskAssignees task={task} />
          </CardMeta>
        ) : null}
      </CardContent>
    </Card>
  );
}

const priorityTint = {
  critical: "bg-priority-critical-soft/40",
  high: "bg-priority-high-soft/40",
  medium: "bg-priority-medium-soft/40",
  low: "bg-priority-low-soft/40",
} as const;

export function EventBoardTaskCard(props: CardBodyProps) {
  return <CardBody {...props} />;
}

export function SortableEventBoardTaskCard({
  task,
  permission,
  busy,
  dragDisabled,
  onMoveStatus,
  canEdit,
  onEdit,
}: {
  task: BoardTask;
  permission: MovePermission;
  busy: boolean;
  dragDisabled: boolean;
  onMoveStatus: (task: BoardTask, status: BoardStatus) => void;
  canEdit?: boolean;
  onEdit?: (task: BoardTask) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: dragDisabled,
    data: { type: "task", status: task.status, phase: task.phase },
    // dnd-kit's default 250ms shuffle is too quick to follow; ease it a little slower.
    transition: { duration: 380, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : undefined,
  };
  const dragAttributes = dragDisabled ? undefined : attributes;
  const dragListeners = dragDisabled ? undefined : listeners;

  return (
    <div ref={setNodeRef} style={style} data-motion-replay="" data-motion-sortable="">
      <CardBody
        task={task}
        permission={permission}
        busy={busy}
        dragAttributes={dragAttributes}
        dragListeners={dragListeners}
        onMoveStatus={onMoveStatus}
        canEdit={canEdit}
        onEdit={onEdit}
      />
    </div>
  );
}

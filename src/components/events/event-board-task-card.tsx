"use client";

import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
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
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
    task.due_date !== null ||
    task.primary_assignees.length > 0 ||
    task.assist_assignees.length > 0;
  const canMove = permission !== "none" && !task.is_masked && !overlay;

  return (
    <Card
      className={cn(
        "relative p-0",
        !overlay &&
          "motion-card-interaction hover:border-primary/40 focus-within:border-primary/40",
        task.status === "Completed" && !task.is_masked && "opacity-70",
        overlay &&
          "cursor-grabbing scale-[1.02] opacity-90 shadow-xl motion-reduce:scale-100 motion-reduce:transition-none",
      )}
    >
      {!overlay ? (
        <StretchedLink
          href={`/tasks/${task.id}`}
          label={`Open ${task.title}`}
          className="transition-colors duration-150 hover:bg-muted/40 active:bg-muted/60 motion-reduce:transition-none"
        />
      ) : null}
      <CardContent className="space-y-2.5 p-3.5">
        <div className="flex items-start justify-between gap-2.5">
          {!task.is_masked && task.effective_priority ? (
            <PriorityBadge
              priority={task.effective_priority}
              className={cn(backlog && "px-2 text-xs")}
            />
          ) : (
            <Badge variant="neutral">
              <LockKeyhole aria-hidden /> Confidential
            </Badge>
          )}

          <div className="relative z-20 flex items-center gap-1">
            {canEdit && onEdit && !overlay ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="size-11 rounded-full transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:bg-muted motion-reduce:transition-none md:size-8"
                      aria-label={`Task actions for ${task.title}`}
                      onClick={(event) => event.stopPropagation()}
                    />
                  }
                >
                  <MoreHorizontal aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => onEdit(task)}>
                    <Pencil aria-hidden /> Edit task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {task.status === "Completed" && !task.is_masked ? (
              <Check
                className="size-4 text-emerald-600"
                aria-label="Completed"
              />
            ) : null}
            {canMove && task.status !== "Completed" ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-lg"
                className="motion-control-pop size-11 rounded-full border-2 border-border active:bg-muted md:hidden"
                aria-label={`Mark ${task.title} Completed`}
                aria-busy={busy}
                disabled={busy}
                onClick={() => onMoveStatus?.(task, "Completed")}
              >
                {busy ? (
                  <LoaderCircle
                    className="motion-safe:animate-spin"
                    aria-hidden
                  />
                ) : (
                  <span className="size-3 rounded-full" aria-hidden />
                )}
              </Button>
            ) : null}
            {dragAttributes && dragListeners ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="inline-flex size-11 cursor-grab touch-none select-none transition-colors duration-150 [-webkit-touch-callout:none] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing active:bg-muted aria-pressed:cursor-grabbing aria-pressed:bg-muted motion-reduce:transition-none md:hidden"
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
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="hidden cursor-grab touch-none select-none transition-colors duration-150 [-webkit-touch-callout:none] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing active:bg-muted aria-pressed:cursor-grabbing aria-pressed:bg-muted motion-reduce:transition-none md:inline-flex"
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
              </>
            ) : null}
          </div>
        </div>

        <p
          className={cn(
            "text-sm leading-snug font-semibold",
            backlog && "line-clamp-2",
            task.status === "Completed" &&
              !task.is_masked &&
              "line-through decoration-muted-foreground",
          )}
        >
          {task.title}
        </p>

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
            className="relative z-20 w-full transition-colors duration-150 active:bg-primary/70 motion-reduce:transition-none"
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
          <div className="flex min-h-6 items-center justify-between gap-3">
            <TaskAssignees task={task} />
            <span className="text-xs text-muted-foreground">
              {task.is_masked
                ? null
                : task.status === "Completed"
                  ? "Completed"
                  : task.due_date
                    ? `Due ${dueDateFormatter.format(new Date(task.due_date))}`
                    : null}
            </span>
          </div>
        ) : null}

        {canMove ? (
          <div className="relative z-20">
            <Select
              value={task.status}
              disabled={busy}
              onValueChange={(value) => {
                if (
                  value &&
                  BOARD_STATUSES.includes(value as BoardStatus) &&
                  value !== task.status
                ) {
                  onMoveStatus?.(task, value as BoardStatus);
                }
              }}
            >
              <SelectTrigger
                className="h-11 w-full text-xs transition-colors duration-150 active:bg-muted motion-reduce:transition-none sm:h-9"
                aria-label={`Move ${task.title} to another status`}
              >
                <span className="text-muted-foreground">Move to</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BOARD_STATUSES.map((status) => (
                  <SelectItem
                    key={status}
                    value={status}
                    disabled={status === task.status}
                  >
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

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
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : undefined,
  };
  const dragAttributes = dragDisabled ? undefined : attributes;
  const dragListeners = dragDisabled ? undefined : listeners;

  return (
    <div ref={setNodeRef} style={style}>
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

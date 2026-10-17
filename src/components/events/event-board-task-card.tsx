"use client";

import type { CSSProperties } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Check,
  GripVertical,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import Link from "next/link";
import { UserAvatar } from "@/components/shared/user-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BOARD_STATUSES,
  type BoardPriority,
  type BoardStatus,
  type BoardTask,
} from "@/lib/events/board";
import type { MovePermission } from "@/lib/events/board-move";
import { cn } from "@/lib/utils";

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "Asia/Manila",
});

function priorityVariant(priority: BoardPriority) {
  if (priority === "Critical") return "destructive" as const;
  if (priority === "High") return "outline" as const;
  return "neutral" as const;
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
    <div className="flex -space-x-2" aria-label="Assignees">
      {assignees.slice(0, 3).map((assignee) => {
        const name = assignee.full_name ?? "Former member";
        return (
          <UserAvatar
            key={assignee.id}
            name={name}
            src={assignee.avatar_url}
            size="sm"
            className="size-7 border-2 border-card text-[10px]"
          />
        );
      })}
      {assignees.length > 3 ? (
        <span className="z-10 inline-flex size-7 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold">
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
        "p-0 transition-[transform,opacity,box-shadow]",
        !overlay && "hover:-translate-y-0.5 hover:shadow-sm",
        task.status === "Completed" && !task.is_masked && "opacity-70",
        overlay && "cursor-grabbing scale-[1.02] opacity-90 shadow-xl",
      )}
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          {!task.is_masked && task.effective_priority ? (
            <Badge
              variant={priorityVariant(task.effective_priority)}
              className={cn(backlog && "gap-1.5 px-2 text-xs")}
            >
              {backlog ? (
                <span className="size-1.5 rounded-full bg-current" aria-hidden />
              ) : null}
              {task.effective_priority}
            </Badge>
          ) : (
            <Badge variant="neutral">
              <LockKeyhole aria-hidden /> Confidential
            </Badge>
          )}

          <div className="flex items-center gap-1">
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
                className="rounded-full border-2 border-border md:hidden"
                aria-label={`Mark ${task.title} Completed`}
                disabled={busy}
                onClick={() => onMoveStatus?.(task, "Completed")}
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" aria-hidden />
                ) : (
                  <span className="size-3 rounded-full" aria-hidden />
                )}
              </Button>
            ) : null}
            {dragAttributes && dragListeners ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="hidden cursor-grab touch-none md:inline-flex active:cursor-grabbing"
                aria-label={`Drag ${task.title}`}
                disabled={busy}
                {...dragAttributes}
                {...dragListeners}
              >
                <GripVertical aria-hidden />
              </Button>
            ) : null}
          </div>
        </div>

        <Link
          href={`/tasks/${task.id}`}
          aria-label={`Open ${task.title}`}
          className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
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
        </Link>

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

        {!backlog || showBacklogFooter ? (
          <div className="flex min-h-7 items-center justify-between gap-3">
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
              className="h-9 w-full text-xs"
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
}: {
  task: BoardTask;
  permission: MovePermission;
  busy: boolean;
  dragDisabled: boolean;
  onMoveStatus: (task: BoardTask, status: BoardStatus) => void;
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
      />
    </div>
  );
}

"use client";

import {
  CalendarDays,
  Layers,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  Pencil,
  Users,
} from "lucide-react";
import { StretchedLink } from "@/components/shared/stretched-link";
import { PriorityBadge, getPriorityAccentClass } from "@/components/shared/priority-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BoardTask } from "@/lib/events/board";
import { isClaimableBacklogTask } from "@/lib/tasks/backup";
import { formatDateSafe } from "@/lib/safe-date";
import { APP_TIME_ZONE } from "@/lib/timezone";
import { cn } from "@/lib/utils";

const dueDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: APP_TIME_ZONE.iana,
});

/**
 * Compact row for the Task Backlog sheet. Two short lines instead of a tall card:
 * title + menu on top, then who/where (committee, phase, due) and a small Claim button.
 * The whole card still opens the task; Claim and the menu sit above the stretched link.
 */
export function EventBoardBacklogCard({
  task,
  busy = false,
  claimBusy = false,
  onClaim,
  canEdit = false,
  onEdit,
}: {
  task: BoardTask;
  busy?: boolean;
  claimBusy?: boolean;
  onClaim?: (task: BoardTask) => void;
  canEdit?: boolean;
  onEdit?: (task: BoardTask) => void;
}) {
  const masked = task.is_masked;
  const priority = !masked ? task.effective_priority : null;
  const dueLabel = !masked && task.due_date ? formatDateSafe(dueDateFormatter, task.due_date, "") || null : null;
  const phase = task.phase?.trim() || "Unphased";
  const claimable = isClaimableBacklogTask(task) && Boolean(onClaim);
  const showMenu = canEdit && Boolean(onEdit);

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-2xl border border-l-4 bg-card text-card-foreground transition-colors duration-300 focus-within:ring-3 focus-within:ring-ring/30 motion-reduce:transition-none",
        priority ? getPriorityAccentClass(priority) : "border-l-muted-foreground/40",
      )}
    >
      <StretchedLink
        href={`/tasks/${task.id}`}
        label={`Open ${task.title}`}
        className="transition-colors duration-300 hover:bg-muted/40 active:bg-muted/60 motion-reduce:transition-none"
      />
      <div className="grid gap-2 p-3">
        <div className="flex items-start gap-2">
          <h3 className="min-w-0 flex-1 text-[15px] leading-snug font-semibold [overflow-wrap:anywhere]">
            {masked ? "Confidential Task" : task.title}
          </h3>
          {showMenu ? (
            <div className="relative z-20 -mr-1.5 shrink-0">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="-my-2 rounded-full"
                      aria-label={`Task actions for ${task.title}`}
                      aria-busy={busy}
                      onClick={(event) => event.stopPropagation()}
                    />
                  }
                >
                  <MoreHorizontal aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => onEdit?.(task)}>
                    <Pencil aria-hidden /> Edit task
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>

        {!masked ? (
          <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1">
              <Users className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{task.committee_name ?? "Committee unavailable"}</span>
            </span>
            <span className="inline-flex min-w-0 items-center gap-1" title={phase}>
              <Layers className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{phase}</span>
            </span>
            {dueLabel ? (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5 shrink-0" aria-hidden />
                Due {dueLabel}
              </span>
            ) : null}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          {priority ? (
            <PriorityBadge priority={priority} className="px-2 py-0 text-[11px] leading-5" />
          ) : (
            <Badge variant="neutral" className="px-2 py-0 text-[11px]">
              <LockKeyhole aria-hidden /> Confidential
            </Badge>
          )}
          {claimable ? (
            <Button
              type="button"
              size="sm"
              className="relative z-20 min-h-9 min-w-24 px-4 transition-colors duration-300 active:bg-primary/70 motion-reduce:transition-none"
              disabled={busy || claimBusy}
              onClick={() => onClaim?.(task)}
            >
              {claimBusy ? (
                <>
                  <LoaderCircle className="motion-safe:animate-spin" aria-hidden /> Claiming
                </>
              ) : (
                <>
                  Claim<span className="sr-only"> Task</span>
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

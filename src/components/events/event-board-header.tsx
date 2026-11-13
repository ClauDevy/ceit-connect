"use client";

import Link from "next/link";
import { ArrowLeft, CalendarDays, CheckCircle2, RefreshCw } from "lucide-react";
import { EventBanner } from "@/components/events/event-banner";
import { EventBoardProgressRing } from "@/components/events/event-board-progress-ring";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { BoardEvent } from "@/lib/events/board";
import type { BoardViewer } from "@/lib/events/board-move";
import {
  formatEventAutoArchiveWarning,
  type EventAutoArchiveWarning,
} from "@/lib/events/auto-archive-warning";
import { cn } from "@/lib/utils";
import {
  formatEventDateRange,
  formatTaskCount,
} from "./event-board-helpers";

export function EventBoardHeader({
  event,
  viewer,
  autoArchiveWarning,
  completed,
  taskCount,
  completion,
  moveError,
  onDismissMoveError,
  queryError,
  onRetry,
}: {
  event: BoardEvent;
  viewer: BoardViewer;
  autoArchiveWarning: EventAutoArchiveWarning | null;
  completed: number;
  taskCount: number;
  completion: number;
  moveError: string | null;
  onDismissMoveError: () => void;
  queryError: unknown;
  onRetry: () => void;
}) {
  return (
    <>
      <Link
        href="/home"
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "transition-colors duration-300 active:bg-muted motion-reduce:transition-none",
        )}
      >
        <ArrowLeft aria-hidden /> Home
      </Link>

      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="flex flex-col md:flex-row">
          <EventBanner
            src={event.banner_url}
            alt={`${event.name} banner`}
            className="aspect-video w-full md:w-[clamp(20rem,35vw,26.25rem)] md:shrink-0"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="min-w-0 break-words font-display text-2xl font-semibold tracking-tight sm:text-3xl">
                  {event.name}
                </h1>
                <Badge
                  variant="outline"
                  className="border-primary/60 bg-primary/10"
                >
                  Active
                </Badge>
              </div>
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                <CalendarDays className="size-4 shrink-0" aria-hidden />
                {formatEventDateRange(event)}
              </p>
              {event.description ? (
                <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-muted-foreground">
                  {event.description}
                </p>
              ) : null}
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
                {completed} of {formatTaskCount(taskCount)} completed
              </p>
            </div>
            <div className="self-end md:self-auto">
              <EventBoardProgressRing percentage={completion} />
            </div>
          </div>
        </div>
      </section>

      {autoArchiveWarning ? (
        <InlineAlert variant="warning">
          {formatEventAutoArchiveWarning(
            autoArchiveWarning,
            viewer.role === "Admin" || viewer.role === "Co-Admin",
          )}
        </InlineAlert>
      ) : null}

      {moveError ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>{moveError}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onDismissMoveError}
          >
            Dismiss
          </Button>
        </InlineAlert>
      ) : null}

      {queryError ? (
        <InlineAlert className="flex flex-wrap items-center justify-between gap-3">
          <span>
            The board could not refresh. The last successful result is still
            shown.
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
          >
            <RefreshCw aria-hidden /> Retry
          </Button>
        </InlineAlert>
      ) : null}
    </>
  );
}

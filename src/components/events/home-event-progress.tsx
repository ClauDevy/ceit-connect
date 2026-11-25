"use client";

import type { ReactNode } from "react";
import { CircleHelp, ListTodo } from "lucide-react";
import { useVisibilityAnimation } from "@/components/shared/motion";
import type { HomeEventProgress } from "@/lib/events/list-paging";

export function HomeEventProgressSummary({
  eventName,
  progress,
}: {
  eventName: string;
  progress: HomeEventProgress | null | undefined;
}) {
  const progressRevealRef = useVisibilityAnimation<HTMLDivElement>({
    className: "motion-progress-fill",
    observeParent: true,
  });

  if (!progress) {
    return (
      <p className="text-xs text-muted-foreground">Progress unavailable</p>
    );
  }

  const hasAlerts =
    progress.visibleBackupRequestCount > 0 || progress.backlogCount > 0;

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        {progress.phaseLabel ? (
          <p className="min-w-0 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Phase:</span>{" "}
            <span className="break-words">{progress.phaseLabel}</span>
          </p>
        ) : (
          <span />
        )}
        <span className="shrink-0 font-display text-sm font-semibold tabular-nums text-foreground">
          {progress.percentage}%
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={`${eventName} task progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress.percentage}
      >
        <div
          ref={progressRevealRef}
          className="motion-progress-target h-full rounded-full bg-primary"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
      {hasAlerts ? (
        <div className="flex flex-wrap gap-2 pt-0.5 text-xs">
          {progress.visibleBackupRequestCount > 0 ? (
            <StatChip
              icon={<CircleHelp className="size-3.5 shrink-0" aria-hidden />}
              label={`Backup requests you can see: ${progress.visibleBackupRequestCount}`}
              tone="amber"
            />
          ) : null}
          {progress.backlogCount > 0 ? (
            <StatChip
              icon={<ListTodo className="size-3.5 shrink-0" aria-hidden />}
              label={`Backlog: ${progress.backlogCount}`}
              tone="sky"
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// Only counts above zero are shown, so a healthy event stays clean and an event that needs a
// reply (amber backup requests) or has open backlog (blue) stands out.
function StatChip({
  icon,
  label,
  tone,
}: {
  icon: ReactNode;
  label: string;
  tone: "amber" | "sky";
}) {
  return (
    <span
      className={
        tone === "amber"
          ? "inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 font-semibold text-amber-800 dark:text-amber-200"
          : "inline-flex items-center gap-1.5 rounded-full border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 font-semibold text-sky-800 dark:text-sky-200"
      }
    >
      {icon}
      {label}
    </span>
  );
}

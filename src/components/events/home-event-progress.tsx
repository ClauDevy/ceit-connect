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
      <p className="border-t border-border/70 pt-3 text-xs text-muted-foreground">
        Progress unavailable
      </p>
    );
  }

  return (
    <div className="space-y-2.5 border-t border-border/70 pt-3">
      {progress.phaseLabel ? (
        <p className="min-w-0 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Phase:</span>{" "}
          <span className="break-words">{progress.phaseLabel}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <div
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted"
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
        <span className="shrink-0 text-xs font-semibold text-foreground">
          {progress.percentage}%
        </span>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <StatChip
          icon={<CircleHelp className="size-4 shrink-0" aria-hidden />}
          label={`Backup requests you can see: ${progress.visibleBackupRequestCount}`}
          active={progress.visibleBackupRequestCount > 0}
          tone="amber"
        />
        <StatChip
          icon={<ListTodo className="size-4 shrink-0" aria-hidden />}
          label={`Backlog: ${progress.backlogCount}`}
          active={progress.backlogCount > 0}
          tone="sky"
        />
      </div>
    </div>
  );
}

// A count above zero is highlighted (amber for backup requests that need a reply, blue for
// open backlog) so it stands out; zero stays quiet.
function StatChip({
  icon,
  label,
  active,
  tone,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  tone: "amber" | "sky";
}) {
  return (
    <span
      className={
        active
          ? tone === "amber"
            ? "inline-flex items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/15 px-2.5 py-1 font-semibold text-amber-800 dark:text-amber-200"
            : "inline-flex items-center gap-1.5 rounded-full border border-sky-500/50 bg-sky-500/15 px-2.5 py-1 font-semibold text-sky-800 dark:text-sky-200"
          : "inline-flex items-center gap-1.5 rounded-full border border-transparent bg-muted/60 px-2.5 py-1 text-muted-foreground"
      }
    >
      {icon}
      {label}
    </span>
  );
}

import { CircleHelp, ListTodo } from "lucide-react";
import type { HomeEventProgress } from "@/lib/events/list-paging";

export function HomeEventProgressSummary({
  eventName,
  progress,
}: {
  eventName: string;
  progress: HomeEventProgress | null | undefined;
}) {
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
            className="motion-progress-fill h-full rounded-full bg-primary"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-semibold text-foreground">
          {progress.percentage}%
        </span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <CircleHelp className="size-3.5 shrink-0" aria-hidden />
          Backup requests you can see: {progress.visibleBackupRequestCount}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ListTodo className="size-3.5 shrink-0" aria-hidden />
          Backlog: {progress.backlogCount}
        </span>
      </div>
    </div>
  );
}

import type { ActivityRow } from "@/lib/activity-log";
import { ACTIVITY_ACTION_LABELS } from "@/lib/activity-log";
import { cn } from "@/lib/utils";

const dotClasses = {
  INSERT: "bg-success",
  UPDATE: "bg-primary",
  DELETE: "bg-destructive",
} as const;

/** One quiet line above the list: how many changes are on this page, split by action. */
export function ActivityLogSummary({
  rows,
  page,
}: {
  rows: readonly ActivityRow[];
  page: number;
}) {
  const counts = { INSERT: 0, UPDATE: 0, DELETE: 0 };
  for (const row of rows) counts[row.action] += 1;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-1">
      <h2 className="font-display text-lg font-semibold">
        Recent changes
        <span className="ml-2 text-sm font-normal text-muted-foreground">Page {page}</span>
      </h2>
      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(counts) as Array<keyof typeof counts>).map((action) => (
          <li key={action} className="inline-flex items-center gap-1.5">
            <span className={cn("size-2 rounded-full", dotClasses[action])} aria-hidden />
            <span className="font-semibold text-foreground">{counts[action]}</span>
            {ACTIVITY_ACTION_LABELS[action].toLowerCase()}
          </li>
        ))}
      </ul>
    </div>
  );
}

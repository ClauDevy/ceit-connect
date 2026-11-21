import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder rows that match the real timeline cards, so the page does not jump. */
export function ActivityListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="grid gap-2.5" data-skeleton="activity-entries" aria-hidden>
      <Skeleton className="h-5 w-28" />
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-start gap-3 rounded-2xl border bg-card p-3.5 sm:p-4">
          <Skeleton className="size-10 shrink-0 rounded-full sm:size-11" />
          <div className="grid min-w-0 flex-1 gap-2">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

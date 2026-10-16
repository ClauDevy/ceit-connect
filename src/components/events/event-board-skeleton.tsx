import { Skeleton } from "@/components/ui/skeleton";

export function EventBoardSkeleton() {
  return (
    <div className="space-y-6" aria-label="Loading event board">
      <div className="overflow-hidden rounded-3xl border bg-card">
        <Skeleton className="h-28 rounded-none sm:h-36" />
        <div className="space-y-3 p-5 sm:p-8">
          <Skeleton className="h-8 w-64 max-w-full" />
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>
      <div className="flex gap-4 overflow-hidden">
        <Skeleton className="h-9 w-44 shrink-0" />
        <Skeleton className="h-9 w-52 shrink-0" />
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {[0, 1, 2].map((lane) => (
          <div key={lane} className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

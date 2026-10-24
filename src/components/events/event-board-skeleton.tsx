import { Skeleton } from "@/components/ui/skeleton";

export function EventBoardSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-6" aria-label="Loading event board">
      <Skeleton className="h-8 w-20" />
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <Skeleton className="h-28 rounded-none sm:h-36" />
        <div className="flex items-end justify-between gap-4 px-5 py-5 sm:px-7 sm:py-6">
          <div className="min-w-0 flex-1 space-y-3">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="h-4 w-44 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
            <Skeleton className="h-3 w-36 max-w-full" />
          </div>
          <Skeleton className="size-16 shrink-0 rounded-full" />
        </div>
      </div>
      <div className="flex gap-6 overflow-hidden border-b">
        <Skeleton className="h-10 w-44 shrink-0 rounded-none" />
        <Skeleton className="h-10 w-52 shrink-0 rounded-none" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        <Skeleton className="h-11 w-48 shrink-0 sm:h-10" />
        <Skeleton className="h-11 w-40 shrink-0 sm:h-10" />
        <Skeleton className="ml-auto h-11 w-24 shrink-0 sm:h-10" />
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

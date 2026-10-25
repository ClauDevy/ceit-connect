import { Skeleton } from "@/components/ui/skeleton";

export function EventBoardSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-6" aria-label="Loading event board">
      <Skeleton className="h-8 w-20" />
      <div className="overflow-hidden rounded-2xl border border-border/70 bg-card">
        <div className="flex flex-col md:flex-row">
          <Skeleton className="aspect-video w-full rounded-none md:w-[clamp(20rem,35vw,26.25rem)] md:shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5 md:flex-row md:items-center">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-8 w-64 max-w-full" />
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-4 w-80 max-w-full" />
              <Skeleton className="h-3 w-36 max-w-full" />
            </div>
            <Skeleton className="size-16 shrink-0 self-end rounded-full md:self-auto" />
          </div>
        </div>
      </div>
      <div className="flex gap-6 overflow-hidden border-b">
        <Skeleton className="h-10 w-44 shrink-0 rounded-none" />
        <Skeleton className="h-10 w-52 shrink-0 rounded-none" />
      </div>
      <div className="flex flex-wrap gap-2 overflow-hidden">
        <Skeleton className="h-11 w-32 shrink-0 sm:h-10" />
        <Skeleton className="h-11 w-40 shrink-0 sm:h-10" />
        <Skeleton className="ml-auto h-11 w-24 shrink-0 sm:h-10" />
      </div>
      <div className="flex snap-x snap-mandatory gap-4 overflow-hidden pb-2 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:pb-0">
        {[0, 1, 2].map((lane) => (
          <div
            key={lane}
            className="w-[calc(100%-1.5rem)] shrink-0 snap-start space-y-3 md:w-auto md:shrink md:snap-align-none"
          >
            <div className="flex h-11 items-center justify-between gap-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="size-11 rounded-md md:hidden" />
            </div>
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-3 md:hidden">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <Skeleton className="h-1.5 w-6 rounded-full" />
          <Skeleton className="size-1.5 rounded-full" />
          <Skeleton className="size-1.5 rounded-full" />
        </div>
      </div>
    </div>
  );
}

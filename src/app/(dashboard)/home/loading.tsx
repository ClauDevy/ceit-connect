import { Skeleton } from "@/components/ui/skeleton";

function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" aria-hidden>
      <Skeleton className="aspect-video w-full rounded-none" />
      <div className="space-y-3 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
      </div>
    </div>
  );
}

export default function HomeLoading() {
  return (
    <div role="status" aria-label="Loading events">
      <div className="mb-8 space-y-2">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-5" />
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <EventCardSkeleton />
        <EventCardSkeleton />
      </div>
      <div className="mt-8 space-y-3">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-20 w-full rounded-2xl border" />
      </div>
      <span className="sr-only">Loading events…</span>
    </div>
  );
}

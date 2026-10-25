import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/shared/page-skeleton";

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
        <div className="grid gap-2 border-t border-border/70 pt-3">
          <Skeleton className="h-3 w-32" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-1.5 flex-1 rounded-full" />
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
    </div>
  );
}

function DraftCardSkeleton() {
  return (
    <div className="rounded-2xl border-2 border-dashed bg-card p-5 sm:p-6" aria-hidden>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
        <div className="flex min-w-0 items-start gap-3.5">
        <Skeleton className="size-11 shrink-0 rounded-xl" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-11 w-20 rounded-md md:h-8" />
        </div>
      </div>
    </div>
  );
}

export default function HomeLoading() {
  return (
    <div role="status" aria-label="Loading events">
      <PageHeaderSkeleton withAction />
      <div className="mb-4 flex items-end justify-between">
        <div className="grid gap-1.5">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-3 w-52" />
        </div>
        <Skeleton className="h-5 w-9 rounded-full" />
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <EventCardSkeleton />
        <EventCardSkeleton />
      </div>
      <div className="mt-8 space-y-4">
        <div className="flex items-end justify-between">
          <div className="grid gap-1.5">
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
        <DraftCardSkeleton />
      </div>
      <span className="sr-only">Loading events…</span>
    </div>
  );
}

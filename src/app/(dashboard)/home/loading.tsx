import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/shared/page-skeleton";

function EventCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border bg-card" aria-hidden>
      <Skeleton className="aspect-[5/2] w-full rounded-none sm:aspect-video" />
      <div className="space-y-3 p-3.5 sm:space-y-4 sm:p-5">
        <div className="grid gap-2">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="grid gap-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      </div>
    </div>
  );
}

function DraftCardSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border-2 border-dashed bg-card p-3 sm:p-3.5" aria-hidden>
      <Skeleton className="size-11 shrink-0 rounded-xl" />
      <div className="grid flex-1 gap-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-11 w-16 rounded-md md:h-8" />
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
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
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

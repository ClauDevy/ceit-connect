import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ArchivedEventLoading() {
  return (
    <div role="status" aria-label="Loading archived event">
      <Skeleton className="mb-4 h-9 w-36" />
      <Skeleton className="mb-4 h-11 w-full rounded-xl" />

      <Card className="mb-8 grid max-w-5xl overflow-hidden md:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <Skeleton className="aspect-video w-full rounded-none" />
        <div className="grid content-center gap-3 p-4 sm:p-5 md:p-6">
          <div className="flex justify-between gap-3">
            <Skeleton className="h-8 w-64 max-w-[70%]" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </Card>

      <div className="max-w-5xl">
        <div className="mb-4 flex items-center gap-2 border-b pb-2.5">
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 w-5" />
        </div>
        {Array.from({ length: 2 }, (_, phaseIndex) => (
          <div key={phaseIndex} className="mb-7">
            <div className="mb-2.5 flex gap-2 border-b pb-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-14" />
            </div>
            <div className="grid gap-2.5">
              {Array.from({ length: 2 }, (_, taskIndex) => (
                <Card key={taskIndex} className="grid gap-3 rounded-xl p-4">
                  <div className="flex gap-2">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-5 w-72 max-w-full" />
                  <Skeleton className="h-4 w-full" />
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading archived event…</span>
    </div>
  );
}

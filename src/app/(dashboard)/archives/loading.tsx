import { PageHeaderSkeleton } from "@/components/shared/page-skeleton";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function ArchivesLoading() {
  return (
    <div role="status" aria-label="Loading event archives">
      <PageHeaderSkeleton />
      <div className="grid gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="overflow-hidden">
            <div className="flex flex-col sm:flex-row">
              <Skeleton className="aspect-video w-full shrink-0 rounded-none sm:w-52 lg:w-60" />
              <div className="flex min-w-0 flex-1 items-center gap-3 p-4">
                <Skeleton className="hidden size-9 shrink-0 rounded-lg lg:block" />
                <div className="grid min-w-0 flex-1 gap-2">
                  <div className="flex justify-between gap-3">
                    <Skeleton className="h-5 w-48 max-w-[65%]" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-full max-w-xl" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading event archives…</span>
    </div>
  );
}

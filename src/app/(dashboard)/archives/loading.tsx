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
            <div className="flex items-center gap-3 p-3 sm:gap-4 sm:p-3.5">
              <Skeleton className="aspect-video w-24 shrink-0 rounded-xl sm:w-36" />
              <div className="grid min-w-0 flex-1 gap-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-40 max-w-[60%]" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
                <Skeleton className="h-3 w-36" />
              </div>
            </div>
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading event archives…</span>
    </div>
  );
}

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function UsersRosterSkeleton() {
  return (
    <Card
      aria-hidden="true"
      className="min-w-0 overflow-hidden rounded-xl"
      data-skeleton="users-roster"
    >
      <div className="hidden lg:block">
        <div className="grid grid-cols-[2fr_1.2fr_0.8fr_0.9fr_auto] gap-4 border-b bg-muted/60 px-4 py-3">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-3 w-16" />
          ))}
        </div>
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="grid grid-cols-[2fr_1.2fr_0.8fr_0.9fr_auto] items-center gap-4 border-b px-4 py-3 last:border-b-0"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="grid min-w-0 gap-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-48 max-w-full" />
              </div>
            </div>
            <Skeleton className="h-5 w-28 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="size-9 rounded-xl" />
          </div>
        ))}
      </div>

      <div className="divide-y lg:hidden">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="grid gap-3 p-3.5 sm:p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="size-10 shrink-0 rounded-full" />
              <div className="grid min-w-0 flex-1 gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-44 max-w-full" />
              </div>
              <Skeleton className="size-11 rounded-xl md:size-9" />
            </div>
            <div className="flex flex-wrap gap-2 pl-[3.25rem]">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-28 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

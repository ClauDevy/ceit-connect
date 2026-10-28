import { PageHeaderSkeleton } from "@/components/shared/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";
import { UsersRosterSkeleton } from "@/components/users/users-roster-skeleton";

export default function UsersLoading() {
  return (
    <div role="status" aria-label="Loading members">
      <PageHeaderSkeleton withAction />
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-11 w-full rounded-xl sm:max-w-sm md:h-10" />
        <Skeleton className="h-4 w-28" />
      </div>

      <UsersRosterSkeleton />
      <span className="sr-only">Loading members…</span>
    </div>
  );
}

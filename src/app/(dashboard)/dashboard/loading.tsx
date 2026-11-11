import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading Executive Dashboard" className="space-y-6">
      <span className="sr-only">Loading Executive Dashboard</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-24" />)}
      </div>
      <Skeleton className="h-48" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
    </div>
  );
}

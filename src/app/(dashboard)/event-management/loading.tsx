import { Skeleton } from "@/components/ui/skeleton";

export default function EventManagementLoading() {
  return (
    <div role="status" aria-label="Loading Event Management" className="space-y-6">
      <div className="space-y-2"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-full max-w-xl" /></div>
      <Skeleton className="h-28 w-full rounded-2xl" />
      <Skeleton className="h-72 w-full rounded-2xl" />
    </div>
  );
}

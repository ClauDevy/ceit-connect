import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeaderSkeleton } from "@/components/shared/page-skeleton"

/** Workspace: two tabs, two filters, then task rows (title, chips, meta line). */
export function WorkspaceSkeleton() {
  return (
    <div role="status" aria-label="Loading workspace" className="space-y-6 md:space-y-7">
      <PageHeaderSkeleton />
      <Skeleton className="h-14 w-full rounded-2xl" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-11 rounded-xl" />
        <Skeleton className="h-11 rounded-xl" />
      </div>
      <Skeleton className="h-4 w-48" />
      <Card className="overflow-hidden" data-skeleton="workspace-tasks">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="grid gap-2 border-b p-4 last:border-b-0">
            <Skeleton className="h-5 w-3/5" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-3 w-2/5" />
          </div>
        ))}
      </Card>
      <span className="sr-only">Loading workspace…</span>
    </div>
  )
}

/** Activity log: filter bar plus a timeline of entries. */
export function ActivityLogSkeleton() {
  return (
    <div role="status" aria-label="Loading activity log">
      <PageHeaderSkeleton />
      <Skeleton className="mb-4 h-11 w-full rounded-xl md:h-10" />
      <div className="grid gap-3" data-skeleton="activity-entries">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="flex items-start gap-3 rounded-2xl border bg-card p-3.5">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-2">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading activity log…</span>
    </div>
  )
}

/** Create / edit event: tab bar, banner, fields, and the continue button. */
export function EventFormSkeleton() {
  return (
    <div role="status" aria-label="Loading event form">
      <PageHeaderSkeleton />
      <Card className="overflow-hidden" data-skeleton="event-form">
        <div className="flex gap-4 border-b p-4">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-6 w-16" />
        </div>
        <div className="grid gap-5 p-5">
          <Skeleton className="aspect-video w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="h-11 rounded-xl" />
            <Skeleton className="h-11 rounded-xl" />
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-md md:w-44" />
        </div>
      </Card>
      <span className="sr-only">Loading event form…</span>
    </div>
  )
}

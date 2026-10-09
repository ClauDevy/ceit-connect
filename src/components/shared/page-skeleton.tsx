import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

/** Matches <PageHeader> so the layout doesn't jump when real content arrives. */
export function PageHeaderSkeleton({ withAction = false }: { withAction?: boolean }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4 md:mb-8">
      <div className="grid gap-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {withAction && <Skeleton className="h-10 w-32 shrink-0 rounded-xl" />}
    </div>
  )
}

/** Generic fallback for any dashboard page without its own loading state. */
export function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading page">
      <PageHeaderSkeleton />
      <Card className="grid gap-3 p-6">
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </Card>
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading members">
      <PageHeaderSkeleton withAction />
      <Skeleton className="mb-4 h-10 w-full rounded-xl sm:max-w-xs" />
      <Card className="divide-y overflow-hidden">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 p-4">
            <Skeleton className="size-8 shrink-0 rounded-full" />
            <div className="grid flex-1 gap-1.5">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-3 w-56 max-w-full" />
            </div>
            <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
          </div>
        ))}
      </Card>
    </div>
  )
}

export function SettingsSkeleton() {
  return (
    <div role="status" aria-label="Loading settings">
      <PageHeaderSkeleton />
      <div className="grid max-w-xl gap-5">
        {[0, 1].map((i) => (
          <Card key={i} className="grid gap-4 p-6">
            <Skeleton className="h-5 w-32" />
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <Skeleton className="h-10 w-32 rounded-xl" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}

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
    <div role="status" aria-label="Loading dashboard page">
      <PageHeaderSkeleton />
      <span className="sr-only">Loading dashboard page…</span>
    </div>
  )
}

export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading members">
      <PageHeaderSkeleton withAction />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-11 w-full rounded-xl sm:max-w-xs md:h-10" />
        <Skeleton className="h-4 w-28" />
      </div>
      <Card className="overflow-hidden" data-skeleton="users-roster">
        <div className="hidden md:block">
          <div className="grid grid-cols-[2fr_1.3fr_1fr_0.8fr_auto] gap-4 border-b p-4">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-3 w-16" />
            ))}
          </div>
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="flex items-center gap-3 border-b p-4 last:border-b-0">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
              <Skeleton className="h-6 w-20 rounded-full" />
              <Skeleton className="size-9 rounded-md" />
            </div>
          ))}
        </div>
        <div className="divide-y md:hidden">
          {Array.from({ length: Math.min(rows, 4) }, (_, i) => (
            <div key={i} className="grid gap-3 p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-44 max-w-full" />
                </div>
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
              <div className="flex justify-between gap-3">
                <Skeleton className="h-6 w-36" />
                <Skeleton className="size-11 rounded-md" />
              </div>
            </div>
          ))}
        </div>
      </Card>
      <span className="sr-only">Loading members…</span>
    </div>
  )
}

export function SettingsSkeleton() {
  return (
    <div role="status" aria-label="Loading settings">
      <PageHeaderSkeleton />
      <div className="grid max-w-xl gap-5">
        {["profile", "photo", "password"].map((section) => (
          <Card key={section} className="grid gap-4 p-6" data-skeleton={`settings-${section}`}>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-72 max-w-full" />
            {section === "photo" ? (
              <div className="flex items-center gap-4">
                <Skeleton className="size-16 rounded-full" />
                <Skeleton className="h-11 w-32 rounded-xl md:h-10" />
              </div>
            ) : (
              <>
                <Skeleton className="h-11 w-full rounded-xl md:h-10" />
                <Skeleton className="h-11 w-28 rounded-xl md:h-9" />
              </>
            )}
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading settings…</span>
    </div>
  )
}

import * as React from "react"
import { cn } from "@/lib/utils"

type PageHeaderProps = {
  title: string
  description?: string
  /** Primary action(s). Sit beside the title; the description always gets the full width below. */
  actions?: React.ReactNode
  /** Phones only: put the actions on their own full-width row under the description. */
  stackActions?: boolean
}

export function PageHeader({ title, description, actions, stackActions = false }: PageHeaderProps) {
  return (
    <header className="mb-5 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1.5 md:mb-7">
      <h1 className="col-start-1 row-start-1 min-w-0 font-display text-2xl font-semibold tracking-tight lg:text-[28px]">
        {title}
      </h1>
      {description && (
        <p className="col-span-2 row-start-2 max-w-prose text-sm text-muted-foreground sm:col-span-1">
          {description}
        </p>
      )}
      {actions && (
        <div
          className={cn(
            "flex items-center gap-2",
            stackActions
              ? "col-span-2 row-start-3 mt-2 sm:col-span-1 sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0"
              : "col-start-2 row-start-1 sm:row-span-2",
          )}
        >
          {actions}
        </div>
      )}
    </header>
  )
}

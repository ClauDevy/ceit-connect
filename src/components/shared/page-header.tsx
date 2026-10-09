import * as React from "react"

type PageHeaderProps = {
  title: string
  description?: string
  /** Primary action(s), right-aligned on wide screens and stacked below on phones. */
  actions?: React.ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between md:mb-8">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight lg:text-[28px]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

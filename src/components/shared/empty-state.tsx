import * as React from "react"
import { TigerLogo } from "@/components/ui/tiger-logo"

type EmptyStateProps = {
  title: string
  description?: string
  action?: React.ReactNode
  /** Shorter padding for small panels such as an empty roster tab. */
  compact?: boolean
}

export function EmptyState({ title, description, action, compact = false }: EmptyStateProps) {
  return (
    <div className={compact ? "flex flex-col items-center gap-1.5 px-6 py-7 text-center" : "flex flex-col items-center gap-2 px-6 py-12 text-center"}>
      <TigerLogo size={compact ? 36 : 44} className="motion-empty-breathe shrink-0 opacity-70 grayscale" />
      <p className="font-display font-semibold">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

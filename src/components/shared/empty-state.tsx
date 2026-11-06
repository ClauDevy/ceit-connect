import * as React from "react"
import { Mascot, type MascotPose } from "@/components/ui/mascot"

type EmptyStateProps = {
  title: string
  description?: string
  action?: React.ReactNode
  /** Shorter and smaller for data-heavy screens such as the roster. */
  compact?: boolean
  /** Which tiger to show. Empty lists sleep; a search with no results looks around. */
  pose?: MascotPose
}

/**
 * Friendly empty list: the tiger sits OUTSIDE any card, on the page itself, with a
 * short line under it. Never wrap this in a Card.
 */
export function EmptyState({ title, description, action, compact = false, pose = "sleeping" }: EmptyStateProps) {
  return (
    <div
      className={
        compact
          ? "flex flex-col items-center gap-1 px-6 py-6 text-center"
          : "flex flex-col items-center gap-1.5 px-6 py-10 text-center"
      }
    >
      <Mascot pose={pose} size={compact ? 76 : 112} className="mb-1 shrink-0" />
      <p className="font-display font-semibold">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

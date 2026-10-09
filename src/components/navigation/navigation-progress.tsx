"use client"

import { useNavigation } from "@/components/navigation/navigation-provider"

// Thin indeterminate bar pinned to the top of the viewport while a page loads.
export function NavigationProgress() {
  const { isPending } = useNavigation()

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 overflow-hidden"
      style={{ opacity: isPending ? 1 : 0, transition: "opacity 150ms ease" }}
    >
      <div className="h-full w-1/3 rounded-full bg-primary motion-safe:animate-nav-progress" />
    </div>
  )
}

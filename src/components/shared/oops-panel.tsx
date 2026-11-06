import * as React from "react"
import { Mascot } from "@/components/ui/mascot"

/** Full-page friendly message for 404 and error pages. The tiger sits on the page, not in a card. */
export function OopsPanel({
  title,
  description,
  actions,
}: {
  title: string
  description: string
  actions: React.ReactNode
}) {
  return (
    <main className="motion-success-enter mx-auto flex min-h-[60dvh] w-full max-w-md flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Mascot pose="oops" size={132} className="mb-2" />
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div>
    </main>
  )
}

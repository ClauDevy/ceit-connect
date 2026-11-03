"use client"

import * as React from "react"
import { CircleAlert, X } from "lucide-react"

type AuthAlertProps = {
  children: React.ReactNode
  /** Shows a close button; the alert also goes away on the next sign-in attempt. */
  onDismiss?: () => void
}

// Sign-in errors float above the page instead of sitting in the form. A fixed element takes
// no space in the layout, so showing one can never make the login screen taller or scrollable,
// on phones or on desktop. On md+ it is centred over the form column, not over the brand panel.
export function AuthAlert({ children, onDismiss }: AuthAlertProps) {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(4.5rem+env(safe-area-inset-top))] z-40 px-4 md:left-[42%]">
      <div
        role="alert"
        className="motion-alert-enter pointer-events-auto mx-auto flex max-w-sm items-start gap-3 rounded-xl border border-destructive/30 bg-card px-4 py-3 text-sm text-destructive shadow-lg"
      >
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="min-w-0 flex-1 break-words">{children}</p>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss message"
            className="-mt-1 -mr-2 inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-destructive/80 outline-none transition-colors duration-300 hover:bg-destructive/10 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
          >
            <X className="size-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

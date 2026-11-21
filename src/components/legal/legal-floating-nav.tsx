"use client"

import { useEffect, useState } from "react"
import { ArrowUp, ListTree } from "lucide-react"

const SHOW_AFTER_PX = 480

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

/**
 * Reading helpers for the long legal pages: a thin progress bar at the top, plus floating
 * "Contents" (phones only) and "Back to top" buttons that appear after you scroll.
 * Purely visual; the page works the same without it.
 */
export function LegalFloatingNav() {
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    let frame = 0
    function update() {
      frame = 0
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(window.scrollY / max, 1) : 0)
      setVisible(window.scrollY > SHOW_AFTER_PX)
    }
    function onScroll() {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [])

  function toTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" })
  }

  function toContents() {
    const nav = document.getElementById("legal-contents")
    if (!nav) return
    const details = nav.querySelector("details")
    if (details) {
      details.open = true
      // Move keyboard focus into the opened list so screen reader and keyboard users land there.
      details.querySelector("summary")?.focus({ preventScroll: true })
    }
    nav.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" })
  }

  const button =
    "inline-flex size-12 items-center justify-center gap-2 rounded-full text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"

  return (
    <>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-40 h-1 bg-transparent">
        <div className="h-full origin-left bg-primary" style={{ transform: `scaleX(${progress})` }} />
      </div>
      {visible ? (
        <div className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex items-center gap-1 rounded-full border bg-card p-1 shadow-lg">
          <button type="button" onClick={toContents} className={`${button} w-auto px-4 text-foreground hover:bg-muted lg:hidden`}>
            <ListTree className="size-4" aria-hidden />
            Contents
          </button>
          <button
            type="button"
            onClick={toTop}
            aria-label="Back to top"
            title="Back to top"
            className={`${button} bg-primary text-primary-foreground hover:bg-primary/90`}
          >
            <ArrowUp className="size-5" aria-hidden />
          </button>
        </div>
      ) : null}
    </>
  )
}

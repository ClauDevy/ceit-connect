"use client"

import { useEffect } from "react"

// Returning from Google sign-in (cancel / back) can leave the installed app with a stale
// viewport size or a leftover scroll lock. When the page becomes visible again, clear any
// leftover inline scroll lock and nudge the browser to re-measure so the page scrolls again.
export function ViewportRecovery() {
  useEffect(() => {
    function recover() {
      if (document.visibilityState === "hidden") return
      for (const el of [document.documentElement, document.body]) {
        if (el.style.overflow === "hidden") el.style.removeProperty("overflow")
        if (el.style.position === "fixed") el.style.removeProperty("position")
        el.removeAttribute("data-scroll-locked")
      }
      window.requestAnimationFrame(() => window.dispatchEvent(new Event("resize")))
    }

    window.addEventListener("pageshow", recover)
    window.addEventListener("focus", recover)
    document.addEventListener("visibilitychange", recover)
    return () => {
      window.removeEventListener("pageshow", recover)
      window.removeEventListener("focus", recover)
      document.removeEventListener("visibilitychange", recover)
    }
  }, [])

  return null
}

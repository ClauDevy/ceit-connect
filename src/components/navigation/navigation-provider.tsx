"use client"

import * as React from "react"
import { usePathname, useRouter } from "next/navigation"

type NavigationState = {
  /** The page the user just asked for; flips immediately, before the server answers. */
  pathname: string
  /** True from click until the new page has actually rendered. */
  isPending: boolean
  navigate: (href: string) => void
}

const NavigationContext = React.createContext<NavigationState | null>(null)

// Wrapping router.push in a transition + useOptimistic means:
//  - the sidebar highlight moves on click, not after the server responds
//  - rapid clicks are superseded by the latest one instead of queueing up
//  - `isPending` can drive a progress bar while the next page streams in
export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const currentPath = usePathname()
  const [isPending, startTransition] = React.useTransition()
  const [pathname, setOptimisticPathname] = React.useOptimistic(currentPath)

  const navigate = React.useCallback(
    (href: string) => {
      startTransition(() => {
        setOptimisticPathname(href)
        router.push(href)
      })
    },
    [router, setOptimisticPathname]
  )

  const value = React.useMemo(
    () => ({ pathname, isPending, navigate }),
    [pathname, isPending, navigate]
  )

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}

export function useNavigation() {
  const ctx = React.useContext(NavigationContext)
  if (!ctx) throw new Error("useNavigation must be used inside <NavigationProvider>")
  return ctx
}

/**
 * Click handler for a <Link>. Leaves new-tab / modifier clicks to the browser
 * and ignores clicks on the page you're already on.
 */
export function useNavClick(href: string, afterNavigate?: () => void) {
  const { pathname, navigate } = useNavigation()

  return React.useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return
      }
      event.preventDefault()
      afterNavigate?.()
      if (pathname !== href) navigate(href)
    },
    [afterNavigate, href, navigate, pathname]
  )
}

import * as React from "react"
import { DesktopSidebar } from "@/components/layout/desktop-sidebar"
import { DesktopHeader } from "@/components/layout/desktop-header"
import { MobileNav } from "@/components/layout/mobile-nav"
import { NavigationProgress } from "@/components/navigation/navigation-progress"
import { NavigationProvider } from "@/components/navigation/navigation-provider"
import { MobileTopbar } from "@/components/layout/mobile-topbar"
import type { CurrentUser } from "@/lib/types"

// Desktop/tablet: collapsible sidebar + content column.
// Phones: sticky topbar, bottom tab bar, and a "More" sheet for the rest.
export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return (
    <NavigationProvider>
      <NavigationProgress />
      <div className="flex h-dvh overflow-clip">
        <DesktopSidebar user={user} />
        <div className="flex min-w-0 flex-1 scroll-pt-24 flex-col overflow-x-hidden overflow-y-auto">
          <MobileTopbar user={user} />
          <DesktopHeader user={user} />
          <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 px-4 py-6 pb-28 sm:px-6 md:px-10 md:py-8 md:pb-8">
            {children}
          </main>
        </div>
        <MobileNav user={user} />
      </div>
    </NavigationProvider>
  )
}

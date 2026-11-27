import * as React from "react"
import { DesktopSidebar } from "@/components/layout/desktop-sidebar"
import { DesktopHeader } from "@/components/layout/desktop-header"
import { MobileNav } from "@/components/layout/mobile-nav"
import { NavigationProgress } from "@/components/navigation/navigation-progress"
import { NavigationProvider } from "@/components/navigation/navigation-provider"
import { MobileTopbar } from "@/components/layout/mobile-topbar"
import { AppShellScrollArea } from "@/components/layout/app-shell-scroll-restoration"
import { NotificationProvider } from "@/components/notifications/notification-center"
import { RouteEntrance } from "@/components/shared/motion"
import type { CurrentUser } from "@/lib/types"

// Desktop/tablet: collapsible sidebar + content column.
// Phones: sticky topbar, bottom tab bar, and a "More" sheet for the rest.
export function AppShell({ user, children }: { user: CurrentUser; children: React.ReactNode }) {
  return (
    <NotificationProvider userId={user.id}>
      <NavigationProvider>
        <NavigationProgress />
        <div className="fixed inset-x-0 top-0 flex h-dvh min-h-0 w-full overflow-hidden">
          <DesktopSidebar user={user} />
          <AppShellScrollArea>
            <MobileTopbar user={user} />
            <DesktopHeader user={user} />
            <main className="mx-auto w-full min-w-0 max-w-6xl flex-1 shrink-0 px-4 py-6 sm:px-6 md:px-10 md:py-8">
              <RouteEntrance>{children}</RouteEntrance>
            </main>
            {/* Phones: a real spacer (not padding) so the last card can always scroll clear of the
                fixed bottom nav, even when the browser shrinks the flex column or toolbars resize. */}
            <div
              aria-hidden
              data-app-shell-bottom-spacer
              className="h-[calc(6.5rem+env(safe-area-inset-bottom))] w-full shrink-0 md:hidden"
            />
          </AppShellScrollArea>
          <MobileNav user={user} />
        </div>
      </NavigationProvider>
    </NotificationProvider>
  )
}

"use client"

import { ChevronLeft } from "lucide-react"
import { Brand } from "@/components/layout/brand"
import { NavLink } from "@/components/layout/nav-link"
import { useNavigation } from "@/components/navigation/navigation-provider"
import { SignOutButton } from "@/components/layout/sign-out-button"
import { useSidebarCollapsed } from "@/hooks/use-sidebar-collapsed"
import { isNavActive, navForRole } from "@/lib/nav"
import type { CurrentUser } from "@/lib/types"
import { cn } from "@/lib/utils"

export function DesktopSidebar({ user }: { user: CurrentUser }) {
  const { pathname } = useNavigation()
  const { collapsed, toggle } = useSidebarCollapsed()
  const { all } = navForRole(user.role)

  return (
    <aside
      className={cn(
        "relative hidden shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-[var(--motion-panel-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none md:flex",
        collapsed ? "w-[4.5rem]" : "w-60 lg:w-64"
      )}
    >
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        className="absolute top-9 -right-3 z-30 flex size-6 items-center justify-center rounded-full border bg-sidebar text-muted-foreground outline-none transition-colors hover:text-primary focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ChevronLeft
          className={cn("size-3 transition-transform duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none", collapsed && "rotate-180")}
        />
      </button>

      <div className="flex min-h-0 flex-1 flex-col justify-between gap-6 overflow-y-auto px-3 py-7">
        <div>
          <Brand collapsed={collapsed} className="mb-9 px-1" />
          <nav aria-label="Main" className="flex flex-col gap-1">
            {all.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isNavActive(pathname, item.href)}
                collapsed={collapsed}
              />
            ))}
          </nav>
        </div>

        <div className="border-t pt-4">
          <SignOutButton
            variant={collapsed ? "icon" : "inline"}
            className={cn(collapsed && "flex justify-center")}
          />
        </div>
      </div>
    </aside>
  )
}

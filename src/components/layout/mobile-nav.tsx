"use client"

import { useState } from "react"
import Link from "next/link"
import { Ellipsis } from "lucide-react"
import { useNavClick, useNavigation } from "@/components/navigation/navigation-provider"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { isNavActive, navForRole, type NavItem } from "@/lib/nav"
import type { CurrentUser } from "@/lib/types"
import { cn } from "@/lib/utils"

const tabClass =
  "group relative flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] outline-none transition-colors duration-[var(--motion-interaction-duration)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"

function BottomTab({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  const onClick = useNavClick(item.href)
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(tabClass, active ? "motion-nav-active font-semibold text-primary before:absolute before:top-0 before:left-1/2 before:h-0.5 before:w-6 before:-translate-x-1/2 before:rounded-full before:bg-primary" : "font-medium text-muted-foreground")}
    >
      <Icon className="motion-nav-icon size-5" aria-hidden />
      {/* "Executive Dashboard" is too long for a tab; the full name is in the page header. */}
      {item.href === "/dashboard" ? "Dashboard" : item.label}
    </Link>
  )
}

function MoreLink({ item, active, onNavigate }: { item: NavItem; active: boolean; onNavigate: () => void }) {
  const Icon = item.icon
  const onClick = useNavClick(item.href, onNavigate)
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-3 text-sm outline-none transition-colors duration-[var(--motion-interaction-duration)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
        active ? "bg-muted font-semibold text-primary" : "font-medium hover:bg-secondary"
      )}
    >
      <Icon className="motion-nav-icon size-[18px]" aria-hidden />
      {item.label}
    </Link>
  )
}

export function MobileNav({ user }: { user: CurrentUser }) {
  const { pathname } = useNavigation()
  const [moreOpen, setMoreOpen] = useState(false)
  const { pinned, more } = navForRole(user.role)
  const moreActive = more.some((item) => isNavActive(pathname, item.href))

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 flex items-stretch justify-around border-t bg-card px-1 pt-1.5 pb-[calc(0.4rem+env(safe-area-inset-bottom))] md:hidden"
      >
        {pinned.map((item) => (
          <BottomTab key={item.href} item={item} active={isNavActive(pathname, item.href)} />
        ))}
        {more.length > 0 && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            className={cn(tabClass, moreActive ? "font-semibold text-primary" : "font-medium text-muted-foreground")}
          >
            <Ellipsis className="motion-nav-icon size-5" aria-hidden />
            More
          </button>
        )}
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent>
          <SheetTitle>More pages</SheetTitle>
          <nav aria-label="More pages" className="flex flex-col">
            {more.map((item) => (
              <MoreLink
                key={item.href}
                item={item}
                active={isNavActive(pathname, item.href)}
                onNavigate={() => setMoreOpen(false)}
              />
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  )
}

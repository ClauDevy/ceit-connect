"use client"

import { useState } from "react"
import Link from "next/link"
import { Ellipsis } from "lucide-react"
import { useNavClick, useNavigation } from "@/components/navigation/navigation-provider"
import { Badge } from "@/components/ui/badge"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { SignOutButton } from "@/components/layout/sign-out-button"
import { UserAvatar } from "@/components/shared/user-avatar"
import { isNavActive, navForRole, type NavItem } from "@/lib/nav"
import type { CurrentUser } from "@/lib/types"
import { cn } from "@/lib/utils"

const tabClass =
  "flex flex-1 flex-col items-center justify-center gap-1 rounded-lg py-1.5 text-[10px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"

function BottomTab({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  const onClick = useNavClick(item.href)
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(tabClass, active ? "font-semibold text-primary" : "font-medium text-muted-foreground")}
    >
      <Icon className="size-5" aria-hidden />
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
        "flex items-center gap-3 rounded-xl px-3 py-3 text-sm outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
        active ? "bg-muted font-semibold text-primary" : "font-medium hover:bg-secondary"
      )}
    >
      <Icon className="size-[18px]" aria-hidden />
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
            <Ellipsis className="size-5" aria-hidden />
            More
          </button>
        )}
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent>
          <SheetTitle>More pages</SheetTitle>
          <div className="flex items-center gap-3 px-3 py-2">
            <UserAvatar name={user.name} src={user.avatarUrl} size="sm" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold">{user.name}</p>
              <Badge className="mt-0.5 px-2 text-[11px]">{user.role}</Badge>
            </div>
            <SignOutButton variant="icon" />
          </div>
          <nav aria-label="More pages" className="mt-1 flex flex-col border-t pt-2">
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

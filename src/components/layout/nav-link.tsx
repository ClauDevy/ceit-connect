"use client"

import Link from "next/link"
import { useNavClick } from "@/components/navigation/navigation-provider"
import type { NavItem } from "@/lib/nav"
import { cn } from "@/lib/utils"

type NavLinkProps = {
  item: NavItem
  active: boolean
  collapsed?: boolean
}

export function NavLink({ item, active, collapsed }: NavLinkProps) {
  const Icon = item.icon
  const onClick = useNavClick(item.href)

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium outline-none transition-colors duration-[var(--motion-interaction-duration)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
        collapsed && "justify-center px-0",
        active
          ? "motion-nav-active bg-sidebar-accent font-semibold text-sidebar-primary before:absolute before:top-1/2 before:-left-3 before:h-[22px] before:w-1 before:-translate-y-1/2 before:rounded-r-full before:bg-sidebar-primary"
          : "text-secondary-foreground hover:bg-secondary"
      )}
    >
      <Icon className="motion-nav-icon size-[18px] shrink-0" aria-hidden />
      <span className={cn(collapsed && "sr-only")}>{item.label}</span>
    </Link>
  )
}

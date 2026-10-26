"use client"

import Link from "next/link"
import { LogOut, Settings } from "lucide-react"
import { UserAvatar } from "@/components/shared/user-avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import type { CurrentUser } from "@/lib/types"
import { SettingsWarningDot } from "@/components/layout/settings-warning-dot"

export function AvatarMenu({ user }: { user: CurrentUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open account menu"
        className="grid size-11 place-items-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <UserAvatar name={user.name} src={user.avatarUrl} size="sm" className="motion-avatar" />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label="Account menu">
        <div className="min-w-0 px-3 py-2">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <Badge className="mt-1 px-2 text-[11px]">{user.role}</Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<Link href="/settings" />} closeOnClick>
          <Settings aria-hidden className="size-4" />
          Settings
          {!user.passwordSet ? <SettingsWarningDot className="ml-auto" /> : null}
        </DropdownMenuLinkItem>
        <form action="/auth/signout" method="post">
          {/* Keep the form mounted until the browser starts the native POST navigation. */}
          <DropdownMenuItem
            render={<button type="submit" />}
            nativeButton
            closeOnClick={false}
          >
            <LogOut aria-hidden className="size-4" />
            Sign out
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

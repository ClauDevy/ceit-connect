import { AppLogo } from "@/components/ui/app-logo"
import { AvatarMenu } from "@/components/layout/avatar-menu"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import { MobileNotificationBell } from "@/components/notifications/notification-center"
import type { CurrentUser } from "@/lib/types"

export function MobileTopbar({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border/70 bg-background/85 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] shadow-xs backdrop-blur-sm md:hidden">
      <div className="flex items-center gap-2">
        <AppLogo height={28} />
        <p className="font-display text-[15px] font-semibold">CEIT Connect</p>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <MobileNotificationBell />
        <AvatarMenu user={user} />
      </div>
    </header>
  )
}

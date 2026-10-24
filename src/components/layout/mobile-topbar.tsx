import { TigerLogo } from "@/components/ui/tiger-logo"
import { AvatarMenu } from "@/components/layout/avatar-menu"
import { ThemeToggle } from "@/components/theme/theme-toggle"
import type { CurrentUser } from "@/lib/types"

export function MobileTopbar({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-card/95 px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] backdrop-blur md:hidden">
      <div className="flex items-center gap-2">
        <TigerLogo size={26} />
        <p className="font-display text-[15px] font-semibold">CEIT Connect</p>
      </div>
      <div className="flex items-center gap-2">
        <ThemeToggle />
        <AvatarMenu user={user} />
      </div>
    </header>
  )
}

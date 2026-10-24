import { ThemeToggle } from "@/components/theme/theme-toggle"
import { UserCard } from "@/components/layout/user-card"
import type { CurrentUser } from "@/lib/types"

export function DesktopHeader({ user }: { user: CurrentUser }) {
  return (
    <header className="sticky top-0 z-20 hidden shrink-0 border-b border-border/70 bg-background/85 shadow-xs backdrop-blur-sm md:block">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-4 px-10 py-3">
        <ThemeToggle />
        <UserCard user={user} />
      </div>
    </header>
  )
}

import { ThemeToggle } from "@/components/theme/theme-toggle"
import { UserCard } from "@/components/layout/user-card"
import type { CurrentUser } from "@/lib/types"

export function DesktopHeader({ user }: { user: CurrentUser }) {
  return (
    <header className="hidden shrink-0 border-b bg-card/95 backdrop-blur md:block">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-end gap-4 px-10 py-3">
        <ThemeToggle />
        <UserCard user={user} />
      </div>
    </header>
  )
}

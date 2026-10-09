import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/shared/user-avatar"
import { SignOutButton } from "@/components/layout/sign-out-button"
import type { CurrentUser } from "@/lib/types"

export function UserCard({ user, collapsed }: { user: CurrentUser; collapsed?: boolean }) {
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 border-t pt-4">
        <UserAvatar name={user.name} src={user.avatarUrl} size="sm" />
        <SignOutButton variant="icon" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <div className="flex items-center gap-2.5">
        <UserAvatar name={user.name} src={user.avatarUrl} size="sm" />
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold">{user.name}</p>
          <Badge className="mt-0.5 px-2 text-[11px]">{user.role}</Badge>
        </div>
      </div>
      <SignOutButton className="-ml-2.5" />
    </div>
  )
}

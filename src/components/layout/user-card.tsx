import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/shared/user-avatar"
import type { CurrentUser } from "@/lib/types"

export function UserCard({ user }: { user: CurrentUser }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <UserAvatar name={user.name} src={user.avatarUrl} size="md" />
      <div className="min-w-0 leading-tight">
        <p className="max-w-48 truncate text-sm font-semibold">{user.name}</p>
        <Badge className="mt-1 px-2 text-[11px]">{user.role}</Badge>
      </div>
    </div>
  )
}

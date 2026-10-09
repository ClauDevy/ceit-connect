import { Badge } from "@/components/ui/badge"
import { UserAvatar } from "@/components/shared/user-avatar"
import { MemberAction } from "@/components/users/member-actions"
import { MemberStatusBadge } from "@/components/users/member-status-badge"
import type { Member } from "@/lib/types"

type MembersCardsProps = {
  members: Member[]
  committeeName: (id: string | null) => string
  currentUserId: string
  pendingId: string | null
  onToggle: (member: Member) => void
}

// Phone layout: a five-column table doesn't fit, so each member is a card.
// Everything that can grow (name, email, committee) shrinks or wraps; the
// status badge and the action button never do, so they can't be pushed
// outside the card and become untappable.
export function MembersCards({ members, committeeName, currentUserId, pendingId, onToggle }: MembersCardsProps) {
  return (
    <ul className="divide-y">
      {members.map((member) => (
        <li key={member.id} aria-busy={pendingId === member.id} className="grid min-w-0 gap-3 p-4">
          <div className="flex min-w-0 items-start gap-3">
            <UserAvatar name={member.full_name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{member.full_name}</p>
              <p className="truncate text-xs text-muted-foreground">{member.email}</p>
            </div>
            <MemberStatusBadge active={member.is_active} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{member.role}</Badge>
              <span className="min-w-0 break-words">{committeeName(member.committee_id)}</span>
            </div>
            <div className="shrink-0">
              <MemberAction
                member={member}
                isSelf={member.id === currentUserId}
                pending={pendingId !== null}
                onToggle={onToggle}
              />
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}

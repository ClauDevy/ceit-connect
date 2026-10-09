import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { UserAvatar } from "@/components/shared/user-avatar"
import { MemberAction } from "@/components/users/member-actions"
import { MemberStatusBadge } from "@/components/users/member-status-badge"
import type { Member } from "@/lib/types"

type MembersListProps = {
  members: Member[]
  committeeName: (id: string | null) => string
  currentUserId: string
  pendingId: string | null
  onToggle: (member: Member) => void
}

export function MembersTable({ members, committeeName, currentUserId, pendingId, onToggle }: MembersListProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>Name</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Committee</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-px">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow key={member.id} aria-busy={pendingId === member.id}>
            <TableCell>
              <div className="flex items-center gap-3">
                <UserAvatar name={member.full_name} size="sm" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </div>
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{member.role}</Badge>
            </TableCell>
            <TableCell>{committeeName(member.committee_id)}</TableCell>
            <TableCell>
              <MemberStatusBadge active={member.is_active} />
            </TableCell>
            <TableCell className="text-right">
              <MemberAction member={member} isSelf={member.id === currentUserId} onToggle={onToggle} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

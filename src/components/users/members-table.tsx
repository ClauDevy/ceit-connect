import { UserAvatar } from "@/components/shared/user-avatar";
import { MemberAction } from "@/components/users/member-actions";
import { MemberStatusBadge } from "@/components/users/member-status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Member } from "@/lib/types";
import { cn } from "@/lib/utils";

type MembersListProps = {
  members: Member[];
  committeeName: (id: string | null) => string;
  currentUserId: string;
  pendingId: string | null;
  onToggle: (member: Member) => void;
  getRevealProps?: (id: string) => {
    "data-motion-reveal-id": string;
    ref: (node: HTMLElement | null) => void;
  };
};

export function MembersTable({
  members,
  committeeName,
  currentUserId,
  pendingId,
  onToggle,
  getRevealProps,
}: MembersListProps) {
  return (
    <Table className="min-w-[42rem]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="pl-5">User</TableHead>
          <TableHead>Committee</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="w-px pr-4">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((member) => (
          <TableRow
            key={member.id}
            {...getRevealProps?.(member.id)}
            aria-busy={pendingId === member.id}
            className={cn(
              "motion-card-interaction focus-within:bg-primary/5",
            )}
          >
            <TableCell className="min-w-0 py-3 pl-5">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar
                  name={member.full_name}
                  src={member.avatar_url}
                  size="sm"
                  className="motion-avatar"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">{member.full_name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {member.email}
                  </p>
                </div>
              </div>
            </TableCell>
            <TableCell className="py-3">
              <Badge variant="neutral">
                {committeeName(member.committee_id)}
              </Badge>
            </TableCell>
            <TableCell className="py-3">
              <Badge variant="outline">{member.role}</Badge>
            </TableCell>
            <TableCell className="py-3">
              <MemberStatusBadge active={member.is_active} />
            </TableCell>
            <TableCell className="py-3 pr-4 text-right">
              <MemberAction
                member={member}
                isSelf={member.id === currentUserId}
                pending={pendingId !== null}
                onToggle={onToggle}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

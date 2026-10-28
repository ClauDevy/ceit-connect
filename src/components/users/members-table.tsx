import { UserAvatar } from "@/components/shared/user-avatar";
import {
  MemberAction,
  type MemberActionName,
} from "@/components/users/member-actions";
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
import type { Member, PendingOfficerInvite, Role } from "@/lib/types";
import { cn } from "@/lib/utils";

type MembersListProps = {
  members: Member[];
  committeeName: (id: string | null) => string;
  currentUserId: string;
  pendingId: string | null;
  onAction: (action: MemberActionName, member: Member) => void;
  pendingInviteByAuthUserId: ReadonlyMap<string, PendingOfficerInvite>;
  viewerRole: Extract<Role, "Admin" | "Co-Admin">;
  selectionEnabled: boolean;
  selectedIds: ReadonlySet<string>;
  allVisibleSelected: boolean;
  someVisibleSelected: boolean;
  onToggleSelection: (member: Member, selected: boolean) => void;
  onToggleVisibleSelection: () => void;
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
  onAction,
  pendingInviteByAuthUserId,
  viewerRole,
  selectionEnabled,
  selectedIds,
  allVisibleSelected,
  someVisibleSelected,
  onToggleSelection,
  onToggleVisibleSelection,
  getRevealProps,
}: MembersListProps) {
  return (
    <Table className="min-w-[42rem]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {selectionEnabled ? (
            <TableHead className="w-px pl-4 pr-0">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                aria-checked={
                  someVisibleSelected ? "mixed" : allVisibleSelected
                }
                aria-label="Select all visible former members"
                className="motion-control-pop size-4 rounded border-input accent-primary"
                onChange={onToggleVisibleSelection}
              />
            </TableHead>
          ) : null}
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
            className={cn("motion-card-interaction focus-within:bg-primary/5")}
          >
            {selectionEnabled ? (
              <TableCell className="w-px py-3 pl-4 pr-0">
                {member.anonymized_at === null ? (
                  <input
                    type="checkbox"
                    checked={selectedIds.has(member.id)}
                    disabled={member.role === "Admin" || pendingId !== null}
                    aria-label={`Select ${member.full_name}`}
                    className="motion-control-pop size-4 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50"
                    onChange={(event) =>
                      onToggleSelection(member, event.target.checked)
                    }
                  />
                ) : null}
              </TableCell>
            ) : null}
            <TableCell className="min-w-0 py-3 pl-5">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar
                  name={member.full_name}
                  src={member.avatar_url}
                  size="sm"
                  className="motion-avatar"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {member.anonymized_at ? "Former member" : member.full_name}
                  </p>
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
              {pendingInviteByAuthUserId.has(member.id) ? (
                <Badge variant="neutral">Invitation pending</Badge>
              ) : (
                <MemberStatusBadge
                  active={member.is_active}
                  anonymized={member.anonymized_at !== null}
                />
              )}
            </TableCell>
            <TableCell className="py-3 pr-4 text-right">
              <MemberAction
                member={member}
                isSelf={member.id === currentUserId}
                pending={pendingId !== null}
                pendingInvite={pendingInviteByAuthUserId.get(member.id)}
                viewerRole={viewerRole}
                onAction={onAction}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

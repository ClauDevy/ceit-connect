import { UserAvatar } from "@/components/shared/user-avatar";
import { MemberAction, type MemberActionName } from "@/components/users/member-actions";
import { MemberStatusBadge } from "@/components/users/member-status-badge";
import { Badge } from "@/components/ui/badge";
import type { Member, PendingOfficerInvite } from "@/lib/types";
import { cn } from "@/lib/utils";

type MembersListProps = {
  members: Member[];
  committeeName: (id: string | null) => string;
  currentUserId: string;
  pendingId: string | null;
  onAction: (action: MemberActionName, member: Member) => void;
  pendingInviteByAuthUserId: ReadonlyMap<string, PendingOfficerInvite>;
  getRevealProps?: (id: string) => {
    "data-motion-reveal-id": string;
    ref: (node: HTMLElement | null) => void;
  };
};

export function MembersCards({
  members,
  committeeName,
  currentUserId,
  pendingId,
  onAction,
  pendingInviteByAuthUserId,
  getRevealProps,
}: MembersListProps) {
  return (
    <ul className="divide-y">
      {members.map((member) => (
        <li
          key={member.id}
          {...getRevealProps?.(member.id)}
          aria-busy={pendingId === member.id}
          className={cn(
            "motion-card-interaction grid min-w-0 gap-3 p-3.5 hover:bg-primary/5 focus-within:bg-primary/5 sm:p-4",
          )}
        >
          <div className="flex min-w-0 items-start gap-3">
            <UserAvatar
              name={member.full_name}
              src={member.avatar_url}
              size="md"
              className="motion-avatar"
            />
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="truncate font-semibold leading-tight">
                {member.full_name}
              </p>
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {member.email}
              </p>
            </div>
            <div className="shrink-0">
              <MemberAction
                member={member}
                isSelf={member.id === currentUserId}
                pending={pendingId !== null}
                pendingInvite={pendingInviteByAuthUserId.get(member.id)}
                onAction={onAction}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2 pl-[3.25rem]">
            <Badge variant="outline">{member.role}</Badge>
            <Badge variant="neutral" className="max-w-full truncate">
              {committeeName(member.committee_id)}
            </Badge>
            {pendingInviteByAuthUserId.has(member.id) ? (
              <Badge variant="neutral">Invitation pending</Badge>
            ) : (
              <MemberStatusBadge active={member.is_active} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

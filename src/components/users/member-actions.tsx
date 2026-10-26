import {
  ArrowRightLeft,
  Ellipsis,
  MailX,
  Pencil,
  RotateCcw,
  ShieldCheck,
  UserRoundX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Member, PendingOfficerInvite, Role } from "@/lib/types";

export type MemberActionName =
  | "toggle"
  | "edit-name"
  | "cancel-invite"
  | "appoint"
  | "return-to-member"
  | "move-committee"
  | "step-down";

type MemberActionProps = {
  member: Member;
  isSelf: boolean;
  pending: boolean;
  pendingInvite?: PendingOfficerInvite;
  viewerRole: Extract<Role, "Admin" | "Co-Admin">;
  onAction: (action: MemberActionName, member: Member) => void;
};

export function MemberAction({
  member,
  isSelf,
  pending,
  pendingInvite,
  viewerRole,
  onAction,
}: MemberActionProps) {
  if (viewerRole === "Co-Admin") {
    return (
      <ActionMenu member={member} pending={pending}>
        <DropdownMenuItem onClick={() => onAction("edit-name", member)}>
          <Pencil className="size-4" aria-hidden />
          Edit name
        </DropdownMenuItem>
        {member.is_active ? (
          <DestructiveItem onClick={() => onAction("toggle", member)}>
            <UserRoundX className="size-4" aria-hidden />
            Deactivate
          </DestructiveItem>
        ) : (
          <DropdownMenuItem onClick={() => onAction("toggle", member)}>
            <RotateCcw className="size-4" aria-hidden />
            Reactivate
          </DropdownMenuItem>
        )}
      </ActionMenu>
    );
  }

  if (pendingInvite) {
    return (
      <ActionMenu member={member} pending={pending}>
        <DestructiveItem onClick={() => onAction("cancel-invite", member)}>
          <MailX className="size-4" aria-hidden />
          Cancel invitation
        </DestructiveItem>
      </ActionMenu>
    );
  }

  if (member.role === "Admin") {
    if (!isSelf) return null;
    return (
      <ActionMenu member={member} pending={pending}>
        <DestructiveItem onClick={() => onAction("step-down", member)}>
          <UserRoundX className="size-4" aria-hidden />
          Step down to Member
        </DestructiveItem>
      </ActionMenu>
    );
  }

  if (!member.is_active) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => onAction("toggle", member)}
      >
        Reactivate
      </Button>
    );
  }

  return (
    <ActionMenu member={member} pending={pending}>
      {member.role === "Member" ? (
        <>
          <DropdownMenuItem onClick={() => onAction("appoint", member)}>
            <ShieldCheck className="size-4" aria-hidden />
            Appoint as officer
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction("move-committee", member)}>
            <ArrowRightLeft className="size-4" aria-hidden />
            Move committee
          </DropdownMenuItem>
        </>
      ) : (
        <DestructiveItem onClick={() => onAction("return-to-member", member)}>
          <ArrowRightLeft className="size-4" aria-hidden />
          Return to Member
        </DestructiveItem>
      )}
      <DestructiveItem onClick={() => onAction("toggle", member)}>
        <UserRoundX className="size-4" aria-hidden />
        Deactivate
      </DestructiveItem>
    </ActionMenu>
  );
}

function ActionMenu({
  member,
  pending,
  children,
}: {
  member: Member;
  pending: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More actions for ${member.full_name}`}
        disabled={pending}
        className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none md:size-9"
      >
        <Ellipsis className="size-5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={`Actions for ${member.full_name}`}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DestructiveItem({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <DropdownMenuItem
      className="text-destructive transition-colors duration-150 active:bg-destructive/20 data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive motion-reduce:transition-none"
      onClick={onClick}
    >
      {children}
    </DropdownMenuItem>
  );
}

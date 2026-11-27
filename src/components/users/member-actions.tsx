import {
  ArrowRightLeft,
  Ellipsis,
  MailX,
  Pencil,
  Info,
  RotateCcw,
  ShieldCheck,
  UserRoundX,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Member, PendingOfficerInvite, Role } from "@/lib/types";

export type MemberActionName =
  | "toggle"
  | "remove-former-member"
  | "retry-former-member-cleanup"
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
  peerAdminBlockedReason?: string | null;
  onAction: (action: MemberActionName, member: Member) => void;
};

export function MemberAction({
  member,
  isSelf,
  pending,
  pendingInvite,
  viewerRole,
  peerAdminBlockedReason,
  onAction,
}: MemberActionProps) {
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

  if (member.anonymized_at !== null) {
    if (viewerRole === "Co-Admin") {
      return <ActionReason>Anonymized accounts cannot be reactivated.</ActionReason>;
    }
    return (
      <div className="flex items-center justify-end gap-0.5">
        <ActionReason>Anonymized accounts cannot be reactivated.</ActionReason>
        <ActionMenu member={member} pending={pending}>
          <DestructiveItem onClick={() => onAction("retry-former-member-cleanup", member)}>
            <RotateCcw className="size-4" aria-hidden />
            Re-run cleanup
          </DestructiveItem>
        </ActionMenu>
      </div>
    );
  }

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

  if (member.role === "Admin") {
    if (!isSelf) {
      if (member.is_active && peerAdminBlockedReason) {
        return <ActionReason>{peerAdminBlockedReason}</ActionReason>;
      }
      return (
        <div className="flex items-center justify-end gap-0.5">
          {!member.is_active && peerAdminBlockedReason ? (
            <ActionReason>{peerAdminBlockedReason}</ActionReason>
          ) : null}
          <ActionMenu member={member} pending={pending}>
            {member.is_active ? (
              <DestructiveItem onClick={() => onAction("toggle", member)}>
                <UserRoundX className="size-4" aria-hidden />
                Deactivate
              </DestructiveItem>
            ) : (
              <>
                {!peerAdminBlockedReason ? (
                  <DropdownMenuItem onClick={() => onAction("toggle", member)}>
                    <RotateCcw className="size-4" aria-hidden />
                    Reactivate
                  </DropdownMenuItem>
                ) : null}
                <DestructiveItem onClick={() => onAction("remove-former-member", member)}>
                  <UserRoundX className="size-4" aria-hidden />
                  Remove former member
                </DestructiveItem>
              </>
            )}
          </ActionMenu>
        </div>
      );
    }
    return (
      <div className="flex items-center justify-end gap-0.5">
        <ActionReason>
          {peerAdminBlockedReason ??
            "You cannot deactivate or remove your own account."}
        </ActionReason>
        {!peerAdminBlockedReason ? (
          <ActionMenu member={member} pending={pending}>
            <DestructiveItem onClick={() => onAction("step-down", member)}>
              <UserRoundX className="size-4" aria-hidden />
              Step down to Member
            </DestructiveItem>
          </ActionMenu>
        ) : null}
      </div>
    );
  }

  if (!member.is_active) {
    return (
      <ActionMenu member={member} pending={pending}>
        <DropdownMenuItem onClick={() => onAction("toggle", member)}>
          <RotateCcw className="size-4" aria-hidden />
          Reactivate
        </DropdownMenuItem>
        <DestructiveItem
          onClick={() => onAction("remove-former-member", member)}
        >
          <UserRoundX className="size-4" aria-hidden />
          Remove former member
        </DestructiveItem>
      </ActionMenu>
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

// The reason used to print as a six-line paragraph squeezed into the narrow actions column. It is
// now one short label with an info icon; tapping or pressing it opens the full sentence, so it works
// without hover on touch and keyboard.
const SHORT_REASONS: Record<string, string> = {
  "You cannot deactivate or remove your own account.": "Your account",
  "At least one active Admin is required.": "Last Admin",
  "Admin role capacity is currently full.": "Admins full",
  "Anonymized accounts cannot be reactivated.": "Anonymized",
  "Checking Admin safeguards…": "Checking…",
};

function ActionReason({ children }: { children: React.ReactNode }) {
  const full = typeof children === "string" ? children : null;
  const short = full ? SHORT_REASONS[full] : undefined;
  if (!full || !short) {
    return (
      <p className="max-w-48 text-right text-xs text-muted-foreground">
        {children}
      </p>
    );
  }
  // A popover (not an inline <details>) so the explanation never stretches the row. On phones only
  // the info icon shows; from `sm` up the short label sits beside it.
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${short}. Show reason`}
        className="inline-flex size-11 items-center justify-center gap-1.5 rounded-xl text-xs font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors duration-300 hover:bg-accent hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none sm:h-9 sm:w-auto sm:px-2.5 md:h-8"
      >
        <Info className="size-4 shrink-0" aria-hidden />
        <span className="hidden sm:inline">{short}</span>
        <span className="sr-only">{full}</span>
      </PopoverTrigger>
      <PopoverContent className="w-64 max-w-[calc(100vw-2rem)] p-3 text-sm leading-snug">
        {full}
      </PopoverContent>
    </Popover>
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
        className="inline-flex size-11 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors duration-300 hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none md:size-9"
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
      className="text-destructive transition-colors duration-300 active:bg-destructive/20 data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive motion-reduce:transition-none"
      onClick={onClick}
    >
      {children}
    </DropdownMenuItem>
  );
}

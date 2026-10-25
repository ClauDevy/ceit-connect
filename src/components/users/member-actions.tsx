import { Ellipsis, UserRoundX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Member } from "@/lib/types";

type MemberActionProps = {
  member: Member;
  isSelf: boolean;
  pending: boolean;
  onToggle: (member: Member) => void;
};

// Deactivate is destructive and therefore lives in a per-user menu. Reactivate
// remains a direct supporting action, while the current user's row has no menu.
export function MemberAction({
  member,
  isSelf,
  pending,
  onToggle,
}: MemberActionProps) {
  if (isSelf) {
    return (
      <span className="text-xs font-medium text-muted-foreground">You</span>
    );
  }

  if (!member.is_active) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() => onToggle(member)}
      >
        Reactivate
      </Button>
    );
  }

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
        <DropdownMenuItem
          className="text-destructive transition-colors duration-150 active:bg-destructive/20 data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive motion-reduce:transition-none"
          onClick={() => onToggle(member)}
        >
          <UserRoundX className="size-4" aria-hidden />
          Deactivate
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

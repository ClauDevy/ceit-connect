import { Button } from "@/components/ui/button"
import type { Member } from "@/lib/types"

type MemberActionProps = {
  member: Member
  isSelf: boolean
  onToggle: (member: Member) => void
}

// "You" for your own row (self-deactivation is blocked server-side too),
// otherwise a single Deactivate / Reactivate action.
export function MemberAction({ member, isSelf, onToggle }: MemberActionProps) {
  if (isSelf) {
    return <span className="text-xs text-muted-foreground">You</span>
  }

  return member.is_active ? (
    <Button variant="destructive" size="sm" onClick={() => onToggle(member)}>
      Deactivate
    </Button>
  ) : (
    <Button variant="outline" size="sm" onClick={() => onToggle(member)}>
      Reactivate
    </Button>
  )
}

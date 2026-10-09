import { Badge } from "@/components/ui/badge"

export function MemberStatusBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge variant="success">
      <span aria-hidden className="size-1.5 rounded-full bg-emerald-500" />
      Active
    </Badge>
  ) : (
    <Badge variant="neutral">Deactivated</Badge>
  )
}

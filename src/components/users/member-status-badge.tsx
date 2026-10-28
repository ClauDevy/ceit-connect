import { Badge } from "@/components/ui/badge";

export function MemberStatusBadge({
  active,
  anonymized = false,
}: {
  active: boolean;
  anonymized?: boolean;
}) {
  if (anonymized) {
    return <Badge variant="neutral">Removed</Badge>;
  }
  return active ? (
    <Badge variant="success">
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      Active
    </Badge>
  ) : (
    <Badge variant="neutral">Deactivated</Badge>
  );
}

import type { Role } from "@/lib/types"

export const ROLE_OPTIONS: readonly { value: Role; label: string; description: string }[] = [
  { value: "Member", label: "Member", description: "Works on tasks assigned to them." },
  { value: "Co-Admin", label: "Co-Admin", description: "Heads a committee and assigns its tasks." },
  { value: "Admin", label: "Admin", description: "Executive Board with full access." },
]

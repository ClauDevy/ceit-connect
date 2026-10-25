import { cn } from "@/lib/utils"
import { ROLE_OPTIONS } from "@/components/users/role-meta"
import type { Role } from "@/lib/types"

type RolePickerProps = {
  value: Role
  onChange: (role: Role) => void
}

// Radio cards (native inputs, so keyboard and screen readers just work) —
// each role says what it can do, so Admins don't have to remember.
export function RolePicker({ value, onChange }: RolePickerProps) {
  return (
    <fieldset className="grid gap-1.5">
      <legend className="mb-1.5 text-sm font-semibold text-secondary-foreground">Role</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {ROLE_OPTIONS.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="radio"
              name="role"
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                "block h-full rounded-xl border px-3 py-2.5 transition-[color,background-color,border-color,box-shadow] duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
                "hover:border-primary/60 peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                value === option.value ? "border-primary bg-muted" : "bg-card"
              )}
            >
              <span className="block text-sm font-semibold">{option.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                {option.description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

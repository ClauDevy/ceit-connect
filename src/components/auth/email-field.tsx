import { Mail } from "lucide-react"
import { FormField } from "@/components/ui/form-field"
import { IconInput } from "@/components/ui/icon-input"

type EmailFieldProps = {
  value: string
  onChange: (value: string) => void
}

export function EmailField({ value, onChange }: EmailFieldProps) {
  return (
    <FormField label="Council email">
      {(control) => (
        <IconInput
          icon={Mail}
          type="email"
          required
          autoComplete="email"
          placeholder="you@cvsu.edu.ph"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          {...control}
        />
      )}
    </FormField>
  )
}

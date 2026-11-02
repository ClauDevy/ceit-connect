"use client"

import { cn } from "@/lib/utils"

type Option<T extends string> = { value: T; label: string }

type SegmentedControlProps<T extends string> = {
  value: T
  onValueChange: (value: T) => void
  options: readonly Option<T>[]
  "aria-label": string
  className?: string
  disabled?: boolean
}

function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  disabled = false,
  ...props
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={props["aria-label"]}
      className={cn("grid auto-cols-fr grid-flow-col gap-1 rounded-xl bg-secondary p-1", className)}
    >
      {options.map((option) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onValueChange(option.value)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-semibold outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60",
              selected
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }

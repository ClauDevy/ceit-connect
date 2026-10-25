import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 min-h-11 w-full min-w-0 rounded-xl border border-input bg-card px-3.5 text-sm outline-none transition-[color,box-shadow,border-color] duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 motion-reduce:transition-none md:min-h-0 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }

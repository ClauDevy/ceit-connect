import * as React from "react"
import type { LucideIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type IconInputProps = React.ComponentProps<"input"> & {
  icon: LucideIcon
  /** Rendered inside the field's right edge, e.g. a show/hide button. */
  trailing?: React.ReactNode
}

function IconInput({ icon: Icon, trailing, className, ...props }: IconInputProps) {
  return (
    <div className="relative">
      <Icon
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input className={cn("pl-10", trailing && "pr-11", className)} {...props} />
      {trailing && (
        <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>
      )}
    </div>
  )
}

export { IconInput }

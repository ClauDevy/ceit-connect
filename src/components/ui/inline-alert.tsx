import * as React from "react"
import { cn } from "@/lib/utils"

type InlineAlertProps = React.ComponentProps<"div"> & {
  variant?: "error" | "info" | "warning"
}

function InlineAlert({ variant = "error", className, ...props }: InlineAlertProps) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl px-4 py-3 text-sm",
        variant === "error"
          ? "bg-destructive/10 text-destructive"
          : variant === "warning"
            ? "border border-primary/40 bg-primary/10 text-accent-foreground"
            : "bg-muted text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export { InlineAlert }

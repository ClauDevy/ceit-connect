import * as React from "react"
import { cn } from "@/lib/utils"

type InlineAlertProps = React.ComponentProps<"div"> & {
  variant?: "error" | "info"
}

function InlineAlert({ variant = "error", className, ...props }: InlineAlertProps) {
  return (
    <div
      role={variant === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl px-4 py-3 text-sm",
        variant === "error" ? "bg-destructive/10 text-destructive" : "bg-muted text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export { InlineAlert }

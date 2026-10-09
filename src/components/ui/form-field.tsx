import * as React from "react"
import { cn } from "@/lib/utils"

type FormFieldProps = {
  label: string
  hint?: string
  error?: string | null
  /** Sits opposite the label, e.g. a "Forgot password?" link. */
  action?: React.ReactNode
  className?: string
  /** Receives the generated id so the label and control stay linked. */
  children: (control: { id: string; "aria-describedby"?: string }) => React.ReactNode
}

function FormField({ label, hint, error, action, className, children }: FormFieldProps) {
  const id = React.useId()
  const messageId = `${id}-message`
  const message = error ?? hint

  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold text-secondary-foreground">
          {label}
        </label>
        {action}
      </div>
      {children({ id, "aria-describedby": message ? messageId : undefined })}
      {message && (
        <p
          id={messageId}
          role={error ? "alert" : undefined}
          className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}
        >
          {message}
        </p>
      )}
    </div>
  )
}

export { FormField }

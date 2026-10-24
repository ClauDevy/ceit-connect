import * as React from "react"
import { cn } from "@/lib/utils"

type FormFieldProps = {
  label: string
  labelTarget?: "control" | "group"
  hint?: string
  error?: string | null
  /** Sits opposite the label, e.g. a "Forgot password?" link. */
  action?: React.ReactNode
  className?: string
  /** Receives generated ids so a control or grouped control stays labelled. */
  children: (control: {
    id: string
    labelId: string
    "aria-describedby"?: string
  }) => React.ReactNode
}

function FormField({
  label,
  labelTarget = "control",
  hint,
  error,
  action,
  className,
  children,
}: FormFieldProps) {
  const id = React.useId()
  const labelId = `${id}-label`
  const messageId = `${id}-message`
  const message = error ?? hint

  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        {labelTarget === "group" ? (
          <span
            id={labelId}
            className="text-sm font-semibold text-secondary-foreground"
          >
            {label}
          </span>
        ) : (
          <label
            id={labelId}
            htmlFor={id}
            className="text-sm font-semibold text-secondary-foreground"
          >
            {label}
          </label>
        )}
        {action}
      </div>
      {children({
        id,
        labelId,
        "aria-describedby": message ? messageId : undefined,
      })}
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

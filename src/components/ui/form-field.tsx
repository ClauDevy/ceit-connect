import * as React from "react"
import { cn } from "@/lib/utils"

type LabelTarget = "control" | "group"

type FormFieldProps<T extends LabelTarget = "control"> = {
  label: string
  labelTarget?: T
  hint?: string
  error?: string | null
  /** Sits opposite the label, e.g. a "Forgot password?" link. */
  action?: React.ReactNode
  className?: string
  /** Receives generated ids so a control or grouped control stays labelled. */
  children: (control: FormFieldControlProps<T>) => React.ReactNode
}

type SingleControlProps = {
  id: string
  "aria-describedby"?: string
}

type GroupControlProps = SingleControlProps & {
  "aria-labelledby": string
}

type FormFieldControlProps<T extends LabelTarget> = T extends "group"
  ? GroupControlProps
  : SingleControlProps

type ControlPropsInput = {
  id: string
  labelId: string
  describedBy?: string
}

function getFormFieldControlProps(
  input: ControlPropsInput & { labelTarget: "control" },
): SingleControlProps
function getFormFieldControlProps(
  input: ControlPropsInput & { labelTarget: "group" },
): GroupControlProps
function getFormFieldControlProps(
  input: ControlPropsInput & { labelTarget: LabelTarget },
): SingleControlProps | GroupControlProps
function getFormFieldControlProps({
  id,
  labelTarget,
  labelId,
  describedBy,
}: {
  id: string
  labelTarget: LabelTarget
  labelId: string
  describedBy?: string
}): SingleControlProps | GroupControlProps {
  if (labelTarget === "group") {
    return {
      id,
      "aria-labelledby": labelId,
      "aria-describedby": describedBy,
    }
  }

  return {
    id,
    "aria-describedby": describedBy,
  }
}

function FormField<T extends LabelTarget = "control">({
  label,
  labelTarget,
  hint,
  error,
  action,
  className,
  children,
}: FormFieldProps<T>) {
  const id = React.useId()
  const labelId = `${id}-label`
  const messageId = `${id}-message`
  const message = error ?? hint
  const resolvedLabelTarget = labelTarget ?? "control"

  return (
    <div className={cn("grid gap-1.5", className)}>
      <div className="flex items-center justify-between gap-2">
        {resolvedLabelTarget === "group" ? (
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
      {children(getFormFieldControlProps({
        id,
        labelTarget: resolvedLabelTarget,
        labelId,
        describedBy: message ? messageId : undefined,
      }) as FormFieldControlProps<T>)}
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

export { FormField, getFormFieldControlProps }

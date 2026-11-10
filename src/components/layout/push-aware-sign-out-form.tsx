"use client"

import {
  Children,
  cloneElement,
  isValidElement,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { bestEffortPushSignOut } from "@/lib/push/push-sign-out"

export function PushAwareSignOutForm({
  children,
  className,
  userId,
}: {
  children: ReactNode
  className?: string
  userId: string
}) {
  const submitting = useRef(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) return
    submitting.current = true
    setIsSubmitting(true)
    const submissionForm = event.currentTarget.cloneNode(false) as HTMLFormElement
    submissionForm.dataset.pushSignOutSubmission = "true"
    submissionForm.hidden = true
    document.body.append(submissionForm)
    try {
      await bestEffortPushSignOut(userId)
    } catch {
      // Device cleanup is best effort and must never keep the session alive.
    } finally {
      setIsSubmitting(false)
      submitting.current = false
      submissionForm.submit()
    }
  }

  const content = isSubmitting
    ? Children.map(children, (child) => (
        isValidElement<{ children?: ReactNode; disabled?: boolean }>(child)
          ? cloneElement(child, { children: "Signing out…", disabled: true })
          : child
      ))
    : children

  return (
    <form
      action="/auth/signout"
      method="post"
      className={className}
      aria-busy={isSubmitting}
      onSubmit={handleSubmit}
    >
      {content}
      <span className="sr-only" role="status" aria-live="polite">
        {isSubmitting ? "Signing out…" : ""}
      </span>
    </form>
  )
}

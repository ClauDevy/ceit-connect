"use client"

import { useRef, type FormEvent, type ReactNode } from "react"
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (submitting.current) return
    event.preventDefault()
    submitting.current = true
    const form = event.currentTarget
    try {
      await bestEffortPushSignOut(userId)
    } catch {
      // Device cleanup is best effort and must never keep the session alive.
    } finally {
      submitting.current = false
      form.submit()
    }
  }

  return (
    <form
      action="/auth/signout"
      method="post"
      className={className}
      onSubmit={handleSubmit}
    >
      {children}
    </form>
  )
}

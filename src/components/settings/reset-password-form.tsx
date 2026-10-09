"use client"

import { useState } from "react"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { PasswordInput } from "@/components/ui/password-input"

export function ResetPasswordForm() {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle")
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      setStatus("error")
      return
    }
    if (password !== confirm) {
      setError("Passwords don't match")
      setStatus("error")
      return
    }

    setStatus("saving")
    setError("")

    const res = await fetch("/api/complete-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })

    const data = await res.json()

    if (!res.ok) {
      setStatus("error")
      setError(data.error ?? "Something went wrong")
      return
    }
    setStatus("done")
  }

  if (status === "done") {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-accent-foreground">Password updated. You can now sign in.</p>
        <Link href="/login" className={buttonVariants({ size: "lg", className: "w-full" })}>
          Go to login
        </Link>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <FormField label="New password" hint="At least 8 characters.">
        {(control) => (
          <PasswordInput
            required
            minLength={8}
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...control}
          />
        )}
      </FormField>
      <FormField label="Confirm new password" error={status === "error" ? error : null}>
        {(control) => (
          <PasswordInput
            required
            minLength={8}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            {...control}
          />
        )}
      </FormField>
      <Button type="submit" size="lg" disabled={status === "saving"}>
        {status === "saving" ? "Saving…" : "Set new password"}
      </Button>
    </form>
  )
}

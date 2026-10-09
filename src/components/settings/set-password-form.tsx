"use client"

import { useState } from "react"
import { CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { PasswordInput } from "@/components/ui/password-input"

export function SetPasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("")
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

    try {
      const res = await fetch("/api/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password,
          ...(hasPassword ? { currentPassword } : {}),
        }),
      })

      let parsed = true
      const data = await res.json().catch(() => {
        parsed = false
        return {}
      })

      if (!parsed || !res.ok) {
        setStatus("error")
        setError(data.error ?? "Something went wrong")
        return
      }

      setStatus("done")
      setCurrentPassword("")
      setPassword("")
      setConfirm("")
    } catch {
      setStatus("error")
      setError("Something went wrong")
    }
  }

  if (status === "done") {
    return (
      <div className="flex items-start gap-3 rounded-xl bg-muted p-4 text-sm text-accent-foreground">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden />
        {hasPassword
          ? "Password updated."
          : "Password set. You can now sign in with Google or your email and password."}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid max-w-sm gap-4">
      {hasPassword && (
        <FormField label="Current password">
          {(control) => (
            <PasswordInput
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              {...control}
            />
          )}
        </FormField>
      )}
      <FormField label={hasPassword ? "New password" : "Password"} hint="At least 8 characters.">
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
      <FormField label={hasPassword ? "Confirm new password" : "Confirm password"} error={status === "error" ? error : null}>
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
      <Button type="submit" disabled={status === "saving"} className="w-fit">
        {status === "saving" ? "Saving…" : hasPassword ? "Change password" : "Set password"}
      </Button>
    </form>
  )
}

"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import { InlineAlert } from "@/components/ui/inline-alert"
import { PasswordInput } from "@/components/ui/password-input"
import { createClient } from "@/lib/supabase/client"
import { finishAuthentication } from "@/lib/auth-navigation"

type ResetPasswordFlowProps = {
  email: string
  onBack: () => void
}

// Two steps. Verifying the emailed code is the only step that consumes the
// one-time code and creates a session, so the password step can be retried
// safely without needing the code again.
export function ResetPasswordFlow({ email, onBack }: ResetPasswordFlowProps) {
  const [step, setStep] = useState<"code" | "password">("code")
  const [code, setCode] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)

    try {
      const supabase = createClient()
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "recovery",
      })

      if (verifyError) {
        setError("That code is incorrect or has expired.")
        return
      }
      setStep("password")
    } catch {
      setError("Unable to verify the code. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setBusy(true)

    try {
      const res = await fetch("/api/complete-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        return
      }
      finishAuthentication(router)
    } catch {
      setError("Network error. Please try again.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="font-display text-2xl font-semibold tracking-tight">Reset your password</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {step === "code"
            ? <>We emailed a code to <b className="text-foreground">{email}</b>.</>
            : "Code verified. Choose a new password."}
        </p>
      </div>

      {step === "code" ? (
        <form onSubmit={handleVerifyCode} className="grid gap-4">
          <FormField label="Verification code">
            {(control) => (
              <Input
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                {...control}
              />
            )}
          </FormField>
          {error && <InlineAlert>{error}</InlineAlert>}
          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? "Checking…" : "Verify code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleSetPassword} className="grid gap-4">
          <FormField label="New password" hint="At least 8 characters.">
            {(control) => (
              <PasswordInput
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                {...control}
              />
            )}
          </FormField>
          {error && <InlineAlert>{error}</InlineAlert>}
          <Button type="submit" size="lg" disabled={busy} className="w-full">
            {busy ? "Saving…" : "Set new password"}
          </Button>
        </form>
      )}

      <Button type="button" variant="ghost" onClick={onBack} className="w-fit text-muted-foreground">
        <ArrowLeft />
        Back to sign in
      </Button>
    </div>
  )
}

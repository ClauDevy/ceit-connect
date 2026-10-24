"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { InlineAlert } from "@/components/ui/inline-alert"
import { PasswordInput } from "@/components/ui/password-input"
import { EmailField } from "@/components/auth/email-field"
import { createClient } from "@/lib/supabase/client"
import { finishAuthentication } from "@/lib/auth-navigation"

type PasswordSignInFormProps = {
  email: string
  onEmailChange: (email: string) => void
  /** Starts the emailed-code reset flow for the typed email. */
  onForgotPassword: () => Promise<void>
}

export function PasswordSignInForm({ email, onEmailChange, onForgotPassword }: PasswordSignInFormProps) {
  const [password, setPassword] = useState("")
  const [signingIn, setSigningIn] = useState(false)
  const [startingReset, setStartingReset] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSigningIn(true)
    setError("")

    try {
      const supabase = createClient()
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })

      if (signInError) {
        setError("Incorrect email or password.")
        return
      }

      finishAuthentication(router)
    } catch {
      setError("Unable to sign in. Please try again.")
    } finally {
      setSigningIn(false)
    }
  }

  async function handleForgot() {
    if (!email) {
      setError("Enter your email above first, then choose Forgot password.")
      return
    }
    setError("")
    setStartingReset(true)
    try {
      await onForgotPassword()
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to send a reset code.")
    } finally {
      setStartingReset(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <EmailField value={email} onChange={onEmailChange} />

      <FormField
        label="Password"
        action={
          <button
            type="button"
            onClick={handleForgot}
            disabled={startingReset}
            className="rounded text-xs font-semibold text-primary outline-none hover:text-accent-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          >
            {startingReset ? "Sending code…" : "Forgot password?"}
          </button>
        }
      >
        {(control) => (
          <PasswordInput
            required
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            {...control}
          />
        )}
      </FormField>

      {error && <InlineAlert>{error}</InlineAlert>}

      <Button type="submit" size="lg" disabled={signingIn} className="w-full">
        {signingIn ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  )
}

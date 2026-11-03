"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { AuthAlert } from "@/components/auth/auth-alert"
import { EmailField } from "@/components/auth/email-field"
import { createClient } from "@/lib/supabase/client"

type MagicLinkFormProps = {
  email: string
  onEmailChange: (email: string) => void
  onSent: () => void
  onAttempt?: () => void
}

export function MagicLinkForm({ email, onEmailChange, onSent, onAttempt }: MagicLinkFormProps) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    onAttempt?.()
    setSending(true)
    setError("")

    try {
      const supabase = createClient()
      const { error: otpError } = await supabase.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      })

      if (otpError) {
        setError(
          "That email isn't recognized. If you're a council member, ask an Admin to invite you first."
        )
        return
      }
      onSent()
    } catch {
      setError(
        "That email isn't recognized. If you're a council member, ask an Admin to invite you first."
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <EmailField value={email} onChange={onEmailChange} />
      {error && <AuthAlert onDismiss={() => setError("")}>{error}</AuthAlert>}
      <Button type="submit" size="lg" disabled={sending} className="w-full">
        {sending ? "Sending…" : "Send sign-in link"}
      </Button>
    </form>
  )
}

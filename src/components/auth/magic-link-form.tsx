"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/inline-alert"
import { EmailField } from "@/components/auth/email-field"
import { createClient } from "@/lib/supabase/client"

type MagicLinkFormProps = {
  email: string
  onEmailChange: (email: string) => void
  onSent: () => void
}

export function MagicLinkForm({ email, onEmailChange, onSent }: MagicLinkFormProps) {
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setError("")

    const supabase = createClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })

    setSending(false)

    if (otpError) {
      setError(
        "That email isn't recognized. If you're a council member, ask an Admin to invite you first."
      )
      return
    }
    onSent()
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <EmailField value={email} onChange={onEmailChange} />
      {error && <InlineAlert>{error}</InlineAlert>}
      <Button type="submit" size="lg" disabled={sending} className="w-full">
        {sending ? "Sending…" : "Send sign-in link"}
      </Button>
    </form>
  )
}

"use client"

import { useState } from "react"
import { MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/inline-alert"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { GoogleButton } from "@/components/auth/google-button"
import { MagicLinkForm } from "@/components/auth/magic-link-form"
import { PasswordSignInForm } from "@/components/auth/password-sign-in-form"
import { ResetPasswordFlow } from "@/components/auth/reset-password-flow"
import { createClient } from "@/lib/supabase/client"

type Mode = "magic" | "password"
type View = "sign-in" | "link-sent" | "reset"

const MODES = [
  { value: "password", label: "Password" },
  { value: "magic", label: "Email link" },
] as const

export function SignInPanel({ initialError }: { initialError?: string }) {
  const [view, setView] = useState<View>("sign-in")
  const [mode, setMode] = useState<Mode>("password")
  const [email, setEmail] = useState("")

  async function startPasswordReset() {
    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email)
    setView("reset")
  }

  if (view === "reset") {
    return <ResetPasswordFlow email={email} onBack={() => setView("sign-in")} />
  }

  if (view === "link-sent") {
    return (
      <div className="grid justify-items-center gap-3 text-center">
        <MailCheck className="size-10 text-primary" aria-hidden />
        <h1 className="font-display text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="text-sm text-muted-foreground">
          We sent a sign-in link to <b className="text-foreground">{email}</b>.
        </p>
        <Button variant="ghost" className="mt-2 text-muted-foreground" onClick={() => setView("sign-in")}>
          Use a different email
        </Button>
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="text-center md:text-left">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in with your council email.</p>
      </div>

      {initialError && <InlineAlert>{initialError}</InlineAlert>}

      <SegmentedControl
        aria-label="Sign-in method"
        options={MODES}
        value={mode}
        onValueChange={setMode}
      />

      {mode === "magic" ? (
        <MagicLinkForm email={email} onEmailChange={setEmail} onSent={() => setView("link-sent")} />
      ) : (
        <PasswordSignInForm
          email={email}
          onEmailChange={setEmail}
          onForgotPassword={startPasswordReset}
        />
      )}

      <div className="flex items-center gap-3" role="separator">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton />
    </div>
  )
}

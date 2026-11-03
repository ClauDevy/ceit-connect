"use client"

import { useState } from "react"
import { MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AuthAlert } from "@/components/auth/auth-alert"
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
  const [initialErrorVisible, setInitialErrorVisible] = useState(Boolean(initialError))

  function suppressInitialError() {
    setInitialErrorVisible(false)
  }

  async function startPasswordReset() {
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email)
    if (error) {
      throw new Error(error.message)
    }
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
    <div className="grid gap-3 sm:gap-5">
      <div className="text-center md:text-left">
        <h1 className="font-display text-lg font-semibold tracking-tight md:text-2xl">Sign in</h1>
        <p className="mt-1 hidden text-sm text-muted-foreground md:block">
          For council officers and members. Use the email your Admin invited.
        </p>
      </div>

      {initialError && initialErrorVisible && (
        <AuthAlert onDismiss={suppressInitialError}>{initialError}</AuthAlert>
      )}

      <SegmentedControl
        aria-label="Sign-in method"
        options={MODES}
        value={mode}
        onValueChange={setMode}
      />

      {mode === "magic" ? (
        <MagicLinkForm
          email={email}
          onEmailChange={setEmail}
          onSent={() => setView("link-sent")}
          onAttempt={suppressInitialError}
        />
      ) : (
        <PasswordSignInForm
          email={email}
          onEmailChange={setEmail}
          onForgotPassword={startPasswordReset}
          onAttempt={suppressInitialError}
        />
      )}

      <div className="flex items-center gap-3" role="separator">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <GoogleButton onAttempt={suppressInitialError} />
    </div>
  )
}

"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { TigerLogo } from "@/components/ui/tiger-logo";

const ERROR_MESSAGES: Record<string, string> = {
  not_invited:
    "That Google account isn't recognized. Ask an Admin to invite you first.",
  set_password_first:
    "Please sign in with your email link first, then set a password in Settings before using Google sign-in.",
  auth: "Something went wrong. Please try again.",
};

export default function LoginPage() {
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [errorMsg, setErrorMsg] = useState("");

  // "sent" = code emailed, not yet entered
  // "verified" = code accepted, session established, waiting on new password
  const [resetStatus, setResetStatus] = useState<
    "idle" | "sending" | "sent" | "verifying" | "verified" | "saving"
  >("idle");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetError, setResetError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const err = params.get("error");
    if (err && ERROR_MESSAGES[err]) {
      setStatus("error");
      setErrorMsg(ERROR_MESSAGES[err]);
    }
  }, []);

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) {
      setStatus("error");
      setErrorMsg(
        "That email isn't recognized. If you're a council member, ask an Admin to invite you first."
      );
      return;
    }
    setStatus("sent");
  }

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setStatus("error");
      setErrorMsg("Incorrect email or password.");
      return;
    }
    window.location.href = "/home";
  }

  async function handleGoogleSignIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  async function handleForgotPassword() {
    if (!email) {
      setStatus("error");
      setErrorMsg("Enter your email above first, then tap Forgot password.");
      return;
    }
    setResetStatus("sending");
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email);
    setResetStatus("sent");
  }

  // Step 1: check the typed code. This is the only step that consumes the
  // one-time code — once it succeeds, a real session exists, so the
  // password step below never needs to touch the code again.
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetStatus("verifying");

    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: resetCode,
      type: "recovery",
    });

    if (verifyError) {
      setResetError("That code is incorrect or has expired.");
      setResetStatus("sent");
      return;
    }

    setResetStatus("verified");
  }

  // Step 2: set the new password using the session from step 1. Safe to
  // retry on failure — doesn't need the code again.
  async function handleSetNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetStatus("saving");

    try {
      const res = await fetch("/api/complete-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setResetError(data.error ?? "Something went wrong");
        setResetStatus("verified");
        return;
      }

      window.location.href = "/home";
    } catch {
      setResetError("Network error — please try again.");
      setResetStatus("verified");
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center bg-background p-6"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cg fill='%23EC6608' fill-opacity='0.05'%3E%3Cellipse cx='60' cy='74' rx='15' ry='13'/%3E%3Ccircle cx='42' cy='48' r='6.5'/%3E%3Ccircle cx='60' cy='38' r='7'/%3E%3Ccircle cx='78' cy='48' r='6.5'/%3E%3C/g%3E%3C/svg%3E\")",
        backgroundSize: "130px 130px",
      }}
    >
      <div className="w-full max-w-sm rounded-2xl border bg-card p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <TigerLogo size={52} />
          <h1 className="mt-3 font-display text-xl font-semibold text-primary">
            CEIT Connect
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your council email.
          </p>
        </div>

        {status === "sent" ? (
          <div className="rounded-xl bg-muted p-4 text-sm text-accent-foreground">
            Check your inbox — we sent a sign-in link to <b>{email}</b>.
          </div>
        ) : (
          <>
            <form
              onSubmit={
                mode === "magic" ? handleMagicLink : handlePasswordLogin
              }
              className="flex flex-col gap-3"
            >
              <input
                type="email"
                required
                placeholder="you@cvsu.edu.ph"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-xl border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
              />

              {mode === "password" && (
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-xl border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              )}

              <button
                type="submit"
                disabled={status === "sending"}
                className="rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-accent-foreground disabled:opacity-50"
              >
                {status === "sending"
                  ? "Please wait..."
                  : mode === "magic"
                  ? "Send sign-in link"
                  : "Sign in"}
              </button>

              {status === "error" && (
                <p className="text-sm text-destructive">{errorMsg}</p>
              )}

              <button
                type="button"
                onClick={() => {
                  setMode(mode === "magic" ? "password" : "magic");
                  setStatus("idle");
                  setErrorMsg("");
                }}
                className="text-xs font-medium text-muted-foreground underline hover:text-primary"
              >
                {mode === "magic"
                  ? "Sign in with password instead"
                  : "Sign in with email link instead"}
              </button>

              {mode === "password" && resetStatus === "idle" && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className="text-xs font-medium text-muted-foreground underline hover:text-primary"
                >
                  Forgot password?
                </button>
              )}
              {mode === "password" && resetStatus === "sending" && (
                <p className="text-xs text-muted-foreground">Sending...</p>
              )}
            </form>

            {mode === "password" &&
              (resetStatus === "sent" || resetStatus === "verifying") && (
                <form
                  onSubmit={handleVerifyCode}
                  className="mt-2 flex flex-col gap-2 rounded-xl bg-muted p-3"
                >
                  <p className="text-xs text-accent-foreground">
                    Enter the 6-digit code we emailed you.
                  </p>
                  <input
                    type="text"
                    required
                    placeholder="6-digit code"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    className="rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                  {resetError && (
                    <p className="text-xs text-destructive">{resetError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={resetStatus === "verifying"}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-accent-foreground disabled:opacity-50"
                  >
                    {resetStatus === "verifying" ? "Checking..." : "Verify Code"}
                  </button>
                </form>
              )}

            {mode === "password" &&
              (resetStatus === "verified" || resetStatus === "saving") && (
                <form
                  onSubmit={handleSetNewPassword}
                  className="mt-2 flex flex-col gap-2 rounded-xl bg-muted p-3"
                >
                  <p className="text-xs text-accent-foreground">
                    Code verified. Enter your new password.
                  </p>
                  <input
                    type="password"
                    required
                    minLength={8}
                    placeholder="New password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                  {resetError && (
                    <p className="text-xs text-destructive">{resetError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={resetStatus === "saving"}
                    className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground hover:bg-accent-foreground disabled:opacity-50"
                  >
                    {resetStatus === "saving" ? "Saving..." : "Set New Password"}
                  </button>
                </form>
              )}

            <div className="my-5 flex items-center gap-3">
              <div className="h-px flex-1 bg-border" />
              <span className="text-xs text-muted-foreground">or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              className="flex w-full items-center justify-center gap-2 rounded-xl border bg-background px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-secondary"
            >
              Continue with Google
            </button>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Only available after your first email sign-in and setting a
              password.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
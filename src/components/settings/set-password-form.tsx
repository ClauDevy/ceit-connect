"use client";

import { useState } from "react";

export function SetPasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      setStatus("error");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match");
      setStatus("error");
      return;
    }

    setStatus("saving");
    setError("");

    const res = await fetch("/api/set-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        password,
        ...(hasPassword ? { currentPassword } : {}),
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus("error");
      setError(data.error ?? "Something went wrong");
      return;
    }

    setStatus("done");
    setCurrentPassword("");
    setPassword("");
    setConfirm("");
  }

  if (status === "done") {
    return (
      <div className="rounded-xl bg-muted p-4 text-sm text-accent-foreground">
        {hasPassword
          ? "Password updated."
          : "Password set! You can now sign in with Google or your email + password."}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-3">
      {hasPassword && (
        <div>
          <label className="mb-1 block text-sm font-medium">Current password</label>
          <input
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-xl border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
          />
        </div>
      )}
      <div>
        <label className="mb-1 block text-sm font-medium">
          {hasPassword ? "New password" : "Password"}
        </label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">
          Confirm {hasPassword ? "new " : ""}password
        </label>
        <input
          type="password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full rounded-xl border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <button
        type="submit"
        disabled={status === "saving"}
        className="rounded-xl bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-accent-foreground disabled:opacity-50"
      >
        {status === "saving" ? "Saving..." : hasPassword ? "Change Password" : "Set Password"}
      </button>
    </form>
  );
}
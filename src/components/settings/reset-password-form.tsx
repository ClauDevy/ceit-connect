"use client";

import { useState } from "react";

export function ResetPasswordForm() {
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

    const res = await fetch("/api/complete-reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus("error");
      setError(data.error ?? "Something went wrong");
      return;
    }
    setStatus("done");
  }

  if (status === "done") {
    return (
      <div className="space-y-4">
        <p className="text-sm text-accent-foreground">
          Password updated. You can now sign in.
        </p>
        <a
          href="/login"
          className="block w-full rounded-xl bg-primary px-3.5 py-2.5 text-center text-sm font-semibold text-primary-foreground hover:bg-accent-foreground"
        >
          Go to login
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label className="mb-1 block text-sm font-medium">New password</label>
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
        <label className="mb-1 block text-sm font-medium">Confirm new password</label>
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
        {status === "saving" ? "Saving..." : "Set New Password"}
      </button>
    </form>
  );
}
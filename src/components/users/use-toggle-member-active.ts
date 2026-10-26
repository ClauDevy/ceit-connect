"use client"

import { useState } from "react"
import type { Member } from "@/lib/types"

// Owns the request/pending/error state for activating or deactivating a
// member, so the table and card layouts stay purely presentational.
export function useToggleMemberActive(onChanged?: () => Promise<void>) {
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState("")

  async function setActive(member: Member, isActive: boolean) {
    setPendingId(member.id)
    setError("")

    try {
      const res = await fetch("/api/toggle-user-active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: member.id, isActive }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? "Something went wrong")
        setPendingId(null)
        return false
      }
    } catch {
      setError("Network error, please try again")
      setPendingId(null)
      return false
    }

    try {
      // Paging owns and displays refresh failures; they must not turn a
      // successful toggle into this hook's network-error state.
      await onChanged?.()
    } catch {
      // A non-paging refresh callback is also best-effort after success.
    } finally {
      setPendingId(null)
    }

    return true
  }

  return { pendingId, error, setActive }
}

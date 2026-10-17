import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import type { Role } from "@/lib/types"

// `cache` dedupes within one server render, so the layout and the page it
// wraps share a single Supabase auth round-trip instead of making two.
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error) {
    console.error("Failed to get authenticated user:", error)
    return null
  }
  return user
})

// Layouts and pages render in parallel, so a redirect in the layout does NOT
// stop the page below it from running. Any page that reads the user must guard
// itself — never `user!` — or it crashes the moment a session expires.
export async function requireUser() {
  const user = await getAuthUser()
  if (!user) redirect("/login")
  return user
}

export async function getActiveProfileForRoles(allowedRoles: readonly Role[]) {
  const supabase = await createClient()
  const user = await requireUser()
  const { data: profile, error } = await supabase
    .from("users")
    .select("role, committee_id, is_active")
    .eq("id", user.id)
    .single()

  if (error) {
    console.error("Failed to get user profile:", error)
    return null
  }

  return profile.is_active && allowedRoles.includes(profile.role) ? profile : null
}

import { cache } from "react"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"

// `cache` dedupes within one server render, so the layout and the page it
// wraps share a single Supabase auth round-trip instead of making two.
export const getAuthUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
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

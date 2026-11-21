import { createClient } from "@/lib/supabase/server"

// The legal pages are public. This only decides whether the back link says
// "Back to home" or "Back to sign in"; it never redirects or blocks.
export async function hasSignedInUser() {
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error) return false
    return Boolean(data.user)
  } catch {
    return false
  }
}

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Use this inside Server Components, Server Actions, and Route Handlers
// (anything running on the server, not "use client"). It reads the
// logged-in user's session from cookies, so queries you run through this
// client are automatically scoped by RLS as that specific user — this is
// how a Co-Admin's `select * from users` naturally returns only their own
// committee (see §2.1 of the architecture doc).
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // setAll called from a Server Component — safe to ignore if
            // you have middleware refreshing sessions (see middleware.ts).
          }
        },
      },
    }
  );
}

// Use ONLY in server-only routes that need to bypass RLS on purpose —
// e.g. the "Deactivate Roster" batch action in §3, which needs to write
// across committees regardless of the caller's own RLS scope. Every route
// using this MUST manually re-check the caller's role first (per §1's
// "Every route using the service-role key must independently re-verify
// the caller's role server-side").
export async function createServiceRoleClient() {
  const { createClient: createSupabaseClient } = await import(
    "@supabase/supabase-js"
  );
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

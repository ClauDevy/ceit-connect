import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  const rawNext = searchParams.get("next");
  const next =
    rawNext &&
    rawNext.startsWith("/") &&
    !rawNext.startsWith("//") &&
    !rawNext.startsWith("/\\")
      ? rawNext
      : "/home";

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const provider = data.user.app_metadata?.provider;

      if (provider === "google") {
        const { data: profile, error: profileError } = await supabase
          .from("users")
          .select("password_set")
          .eq("id", data.user.id)
          .maybeSingle();

        if (profileError) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=auth`);
        }

        if (!profile) {
          await supabase.auth.signOut();
          const adminClient = await createServiceRoleClient();
          await adminClient.auth.admin.deleteUser(data.user.id);
          return NextResponse.redirect(`${origin}/login?error=not_invited`);
        }

        if (!profile.password_set) {
          await supabase.auth.signOut();
          return NextResponse.redirect(
            `${origin}/login?error=set_password_first`
          );
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
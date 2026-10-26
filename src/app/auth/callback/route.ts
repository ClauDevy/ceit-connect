import { NextResponse } from "next/server";
import {
  getNormalizedEmailDomain,
  parseAllowedEmailDomains,
} from "../../../lib/allowed-email-domains";
import { createClient } from "@/lib/supabase/server";

type CallbackClient = Awaited<ReturnType<typeof createClient>>;

async function rejectExchangedSession(
  supabase: CallbackClient,
  origin: string,
) {
  const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
  if (signOutError) {
    console.error("Failed to clear a rejected callback session");
  }
  return NextResponse.redirect(`${origin}/login?error=auth`);
}

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

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=auth`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return rejectExchangedSession(supabase, origin);
  }

  const authEmail = data.user.email?.trim().toLowerCase() ?? "";
  if (!authEmail) {
    return rejectExchangedSession(supabase, origin);
  }

  if (!data.user.email_confirmed_at) {
    return rejectExchangedSession(supabase, origin);
  }

  const { data: profile, error: profileError } = await supabase
    .from("users")
    .select("email, is_active")
    .eq("id", data.user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return rejectExchangedSession(supabase, origin);
  }

  if (!profile.is_active) {
    return rejectExchangedSession(supabase, origin);
  }

  if (profile.email.trim().toLowerCase() !== authEmail) {
    return rejectExchangedSession(supabase, origin);
  }

  const allowedDomains = parseAllowedEmailDomains(
    process.env.ALLOWED_EMAIL_DOMAINS,
  );
  const emailDomain = getNormalizedEmailDomain(authEmail);
  if (
    allowedDomains.length === 0 ||
    !emailDomain ||
    !allowedDomains.includes(emailDomain)
  ) {
    return rejectExchangedSession(supabase, origin);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

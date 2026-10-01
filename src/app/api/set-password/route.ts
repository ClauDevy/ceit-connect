import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { password, currentPassword } = await request.json();

  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const { data: profile } = await supabase
    .from("users")
    .select("password_set")
    .eq("id", user.id)
    .single();

  // Already has a password? Require the current one before changing it —
  // stops someone at an unlocked, already-logged-in laptop from silently
  // taking over the account.
  if (profile?.password_set) {
    if (!currentPassword) {
      return NextResponse.json(
        { error: "Current password is required" },
        { status: 400 }
      );
    }
    const { error: verifyError } = await supabase.auth.signInWithPassword({
      email: user.email!,
      password: currentPassword,
    });
    if (verifyError) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 }
      );
    }
  }

  const { error: pwError } = await supabase.auth.updateUser({ password });
  if (pwError) {
    return NextResponse.json({ error: pwError.message }, { status: 500 });
  }

  const adminClient = await createServiceRoleClient();
  await adminClient.from("users").update({ password_set: true }).eq("id", user.id);

  return NextResponse.json({ success: true });
}
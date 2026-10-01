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

  const { password } = await request.json();
  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const { error: pwError } = await supabase.auth.updateUser({ password });
  if (pwError) {
    return NextResponse.json({ error: pwError.message }, { status: 500 });
  }

  const adminClient = await createServiceRoleClient();
  await adminClient.from("users").update({ password_set: true }).eq("id", user.id);

  return NextResponse.json({ success: true });
}
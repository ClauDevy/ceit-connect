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

  const { avatarUrl } = await request.json();

  if (avatarUrl !== null && typeof avatarUrl !== "string") {
    return NextResponse.json({ error: "Invalid avatar URL" }, { status: 400 });
  }

  const adminClient = await createServiceRoleClient();
  const { error } = await adminClient
    .from("users")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
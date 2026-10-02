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

  let avatarUrl: unknown;
  try {
    ({ avatarUrl } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Never trust a client-supplied URL directly — build the one and only
  // valid URL for this user's own avatar file ourselves, and only allow
  // that (optionally with a cache-busting query string) or null.
  const {
    data: { publicUrl: expected },
  } = supabase.storage.from("avatars").getPublicUrl(`${user.id}/avatar.webp`);

  if (
    avatarUrl !== null &&
    (typeof avatarUrl !== "string" || avatarUrl.split("?")[0] !== expected)
  ) {
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
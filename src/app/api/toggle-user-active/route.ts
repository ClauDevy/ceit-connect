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

  const { data: requester } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (requester?.role !== "Admin") {
    return NextResponse.json(
      { error: "Only Admins can change roster status" },
      { status: 403 }
    );
  }

  const { userId, isActive } = await request.json();

  if (!userId || typeof isActive !== "boolean") {
    return NextResponse.json(
      { error: "userId and isActive are required" },
      { status: 400 }
    );
  }

  if (userId === user.id) {
    return NextResponse.json(
      { error: "You can't deactivate your own account" },
      { status: 400 }
    );
  }

  const adminClient = await createServiceRoleClient();
  const updates: { is_active: boolean; avatar_url?: null } = {
    is_active: isActive,
  };

  if (!isActive) {
    // Offboarding frees up Storage: delete their avatar file, per the
    // architecture doc's "Storage Hack" (§3)
    await adminClient.storage.from("avatars").remove([`${userId}/avatar.webp`]);
    updates.avatar_url = null;
  }

  const { error } = await adminClient
    .from("users")
    .update(updates)
    .eq("id", userId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
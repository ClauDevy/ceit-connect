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
    .select("role, is_active")
    .eq("id", user.id)
    .single();

  if (requester?.role !== "Admin") {
    return NextResponse.json(
      { error: "Only Admins can change roster status" },
      { status: 403 }
    );
  }

  // A deactivated Admin's session may still technically be valid until
  // their next page load triggers the dashboard's sign-out check — this
  // route doesn't go through that check, so it must verify independently.
  if (!requester.is_active) {
    return NextResponse.json(
      { error: "Your account is deactivated" },
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

  // Update the profile first — if this fails, nothing destructive has
  // happened yet. Only remove the avatar file once we know the flag
  // (and the cleared avatar_url) have actually been saved.
  const updates: { is_active: boolean; avatar_url?: null } = {
    is_active: isActive,
  };
  if (!isActive) {
    updates.avatar_url = null;
  }

  const { error: profileError } = await adminClient
    .from("users")
    .update(updates)
    .eq("id", userId);

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }

  if (!isActive) {
    const { error: removeError } = await adminClient.storage
      .from("avatars")
      .remove([`${userId}/avatar.webp`]);

    if (removeError) {
      // The profile is already updated correctly (safe state) — just let
      // the Admin know the file itself may need a retry/manual cleanup.
      return NextResponse.json({
        success: true,
        warning: "User deactivated, but the avatar file could not be removed.",
      });
    }
  }

  return NextResponse.json({ success: true });
}
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

  const { data: target, error: targetError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", userId)
    .single();

  if (targetError || !target) {
    return NextResponse.json(
      { error: "The selected user could not be found" },
      { status: 404 },
    );
  }
  if (target.role === "Admin") {
    return NextResponse.json(
      { error: "Admin accounts cannot be activated or deactivated here" },
      { status: 403 },
    );
  }

  if (target.role === "Co-Admin") {
    const { error: officerError } = await supabase.rpc("set_officer_active", {
      p_user_id: userId,
      p_is_active: isActive,
    });
    if (officerError) {
      const message =
        officerError.code === "CCO03" && !isActive
          ? "Use Cancel invitation for an unaccepted officer invite."
          : officerError.code === "CCO04"
            ? "That officer seat is currently full."
            : "The officer status could not be changed.";
      return NextResponse.json({ error: message }, { status: 409 });
    }

    // This must run even when the idempotent RPC returned without changing a
    // row: an earlier request may have committed Postgres but failed Auth.
    let adminClient: Awaited<ReturnType<typeof createServiceRoleClient>>;
    let authError: unknown;
    try {
      adminClient = await createServiceRoleClient();
      const authResult = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: isActive ? "none" : "876000h",
      });
      authError = authResult.error;
    } catch {
      return NextResponse.json(
        {
          error: "Profile status changed, but login cleanup still needs attention.",
          cleanupPending: true,
        },
        { status: 502 },
      );
    }

    let storageWarning = false;
    if (!isActive) {
      try {
        const { error: removeError } = await adminClient.storage
          .from("avatars")
          .remove([`${userId}/avatar.webp`]);
        storageWarning = Boolean(removeError);
      } catch {
        storageWarning = true;
      }
    }

    if (authError) {
      return NextResponse.json(
        {
          error: "Profile status changed, but login cleanup still needs attention.",
          cleanupPending: true,
          ...(storageWarning
            ? { warning: "The avatar file could not be removed." }
            : {}),
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      success: true,
      ...(storageWarning
        ? { warning: "User status changed, but the avatar file could not be removed." }
        : {}),
    });
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

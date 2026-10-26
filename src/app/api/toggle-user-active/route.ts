import { NextResponse } from "next/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  isUuid,
  safeMemberManagementError,
} from "../../../lib/users/management-contracts";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const requester = await getActiveProfileForRoles(["Admin", "Co-Admin"]);
  if (!requester) {
    return json(
      { error: "Only active Admins and Co-Admins can change roster status" },
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid body" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ error: "Invalid body" }, 400);
  }
  const payload = body as Record<string, unknown>;
  if (
    Object.keys(payload).some((key) => key !== "userId" && key !== "isActive") ||
    !isUuid(payload.userId) ||
    typeof payload.isActive !== "boolean"
  ) {
    return json({ error: "Check the selected user and status" }, 400);
  }

  const supabase = await createClient();
  const userId = payload.userId;
  const isActive = payload.isActive;

  if (requester.role === "Co-Admin") {
    const functionName = isActive
      ? "reactivate_committee_member"
      : "deactivate_committee_member";
    let error: unknown;
    try {
      const result = await supabase.rpc(functionName, { p_user_id: userId });
      error = result.error;
    } catch (rpcError) {
      error = rpcError;
    }
    if (error) {
      const safe = safeMemberManagementError(error);
      return json({ error: safe.message }, safe.status);
    }
    return json({ success: true });
  }

  if (userId === user.id) {
    return json({ error: "You can't deactivate your own account" }, 400);
  }

  const { data: target, error: targetError } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", userId)
    .single();

  if (targetError || !target) {
    return json({ error: "The selected user could not be found" }, 404);
  }
  if (target.role === "Admin") {
    return json(
      { error: "Admin accounts cannot be activated or deactivated here" },
      403,
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
      return json({ error: message }, 409);
    }

    let adminClient: Awaited<ReturnType<typeof createServiceRoleClient>>;
    let authError: unknown;
    try {
      adminClient = await createServiceRoleClient();
      const authResult = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: isActive ? "none" : "876000h",
      });
      authError = authResult.error;
    } catch {
      return json(
        {
          error: "Profile status changed, but login cleanup still needs attention.",
          cleanupPending: true,
        },
        502,
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
      return json(
        {
          error: "Profile status changed, but login cleanup still needs attention.",
          cleanupPending: true,
          ...(storageWarning
            ? { warning: "The avatar file could not be removed." }
            : {}),
        },
        502,
      );
    }

    return json({
      success: true,
      ...(storageWarning
        ? { warning: "User status changed, but the avatar file could not be removed." }
        : {}),
    });
  }

  const adminClient = await createServiceRoleClient();
  const updates: { is_active: boolean; avatar_url?: null } = {
    is_active: isActive,
  };
  if (!isActive) updates.avatar_url = null;

  const { error: profileError } = await adminClient
    .from("users")
    .update(updates)
    .eq("id", userId);

  if (profileError) {
    return json({ error: profileError.message }, 500);
  }

  if (!isActive) {
    const { error: removeError } = await adminClient.storage
      .from("avatars")
      .remove([`${userId}/avatar.webp`]);
    if (removeError) {
      return json({
        success: true,
        warning: "User deactivated, but the avatar file could not be removed.",
      });
    }
  }

  return json({ success: true });
}

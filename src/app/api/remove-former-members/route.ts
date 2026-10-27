import { NextResponse } from "next/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  expectedFormerMemberConfirmation,
  parseAnonymizeRpcRow,
  parseCleanupFormerMemberAuthRpcRow,
  parseFormerMemberPreviewRows,
  parseFormerMemberRequest,
  skippedFormerMemberMessage,
  type FormerMemberRemovalResult,
} from "@/lib/users/former-member-removal";

// This is a deployment hint, not a promise that every host permits 60 seconds.
export const maxDuration = 60;

const AUTH_FAILURE_MESSAGE =
  "Profile anonymization completed, but Auth cleanup failed. The original email is not free yet. Cleanup may be retried.";
const STORAGE_FAILURE_MESSAGE =
  "Profile and Auth cleanup completed, but avatar cleanup is pending. Cleanup may be retried.";
const IDENTITY_CLEANUP_FAILURE_MESSAGE =
  "The profile is anonymized and the original email is free for re-invite, but identity cleanup is pending. Google sign-in for the original address may still resolve to the old banned account until cleanup finishes. Cleanup may be retried.";
const GENERAL_FAILURE_MESSAGE =
  "Removal could not be completed. Cleanup may be retried.";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function hasActiveAdminSession() {
  try {
    const user = await getAuthUser();
    if (!user) return false;
    return Boolean(await getActiveProfileForRoles(["Admin"]));
  } catch {
    return false;
  }
}

function safePreviewError(error: unknown) {
  const code =
    error &&
    typeof error === "object" &&
    typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code
      : null;
  if (code === "CMR01") {
    return {
      status: 403,
      message: "Only active Admins can remove former members.",
    };
  }
  if (code === "CMR02") {
    return { status: 400, message: "Select between 1 and 50 unique accounts." };
  }
  return { status: 500, message: "The removal preview could not be loaded." };
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Not signed in" }, 401);
  if (!(await hasActiveAdminSession())) {
    return json(
      { error: "Only active Admins can remove former members." },
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid body" }, 400);
  }
  const payload = parseFormerMemberRequest(body);
  if (!payload) {
    return json({ error: "Select between 1 and 50 unique accounts." }, 400);
  }

  const callerClient = await createClient();
  let previewResponse: Awaited<ReturnType<typeof callerClient.rpc>>;
  try {
    previewResponse = await callerClient.rpc("preview_former_member_removal", {
      p_user_ids: payload.userIds,
    });
  } catch (error) {
    const safe = safePreviewError(error);
    return json({ error: safe.message }, safe.status);
  }
  if (previewResponse.error) {
    const safe = safePreviewError(previewResponse.error);
    return json({ error: safe.message }, safe.status);
  }
  const preview = parseFormerMemberPreviewRows(
    previewResponse.data,
    payload.userIds,
  );
  if (!preview) {
    return json(
      { error: "The removal preview returned an invalid response." },
      502,
    );
  }

  if (payload.action === "preview") {
    return json({ count: preview.length, users: preview });
  }
  if (
    payload.confirmation !== expectedFormerMemberConfirmation(preview.length)
  ) {
    return json(
      { error: "The confirmation text does not match this preview." },
      400,
    );
  }

  const results: FormerMemberRemovalResult[] = [];
  for (const userId of payload.userIds) {
    if (!(await hasActiveAdminSession())) {
      results.push({
        userId,
        state: "failed",
        message: GENERAL_FAILURE_MESSAGE,
      });
      continue;
    }

    let databaseResponse: Awaited<ReturnType<typeof callerClient.rpc>>;
    try {
      databaseResponse = await callerClient.rpc("anonymize_former_member", {
        p_user_id: userId,
      });
    } catch {
      results.push({
        userId,
        state: "failed",
        message: GENERAL_FAILURE_MESSAGE,
      });
      continue;
    }
    if (databaseResponse.error) {
      const code =
        typeof databaseResponse.error.code === "string"
          ? databaseResponse.error.code
          : null;
      results.push({
        userId,
        state: code === "CMR03" ? "skipped" : "failed",
        message:
          code === "CMR03"
            ? "This account is unavailable for removal."
            : GENERAL_FAILURE_MESSAGE,
      });
      continue;
    }

    const databaseResult = parseAnonymizeRpcRow(databaseResponse.data, userId);
    if (!databaseResult) {
      results.push({
        userId,
        state: "failed",
        message: GENERAL_FAILURE_MESSAGE,
      });
      continue;
    }
    if (databaseResult.outcome === "skipped") {
      if (databaseResult.reasonCode === "anonymized") {
        results.push({
          userId,
          state: "failed",
          message: GENERAL_FAILURE_MESSAGE,
        });
        continue;
      }
      results.push({
        userId,
        state: "skipped",
        reasonCode: databaseResult.reasonCode,
        message: skippedFormerMemberMessage(databaseResult.reasonCode),
      });
      continue;
    }

    if (!(await hasActiveAdminSession())) {
      results.push({ userId, state: "failed", message: AUTH_FAILURE_MESSAGE });
      continue;
    }

    const formerEmail = `${userId}@former.invalid`;
    let adminClient: Awaited<ReturnType<typeof createServiceRoleClient>>;
    try {
      adminClient = await createServiceRoleClient();
      const authResponse = await adminClient.auth.admin.updateUserById(userId, {
        email: formerEmail,
        email_confirm: true,
        ban_duration: "876000h",
      });
      if (
        authResponse.error ||
        !authResponse.data.user ||
        authResponse.data.user.id.toLowerCase() !== userId ||
        authResponse.data.user.email?.toLowerCase() !== formerEmail ||
        !authResponse.data.user.email_confirmed_at ||
        !authResponse.data.user.banned_until ||
        Number.isNaN(Date.parse(authResponse.data.user.banned_until)) ||
        Date.parse(authResponse.data.user.banned_until) <= Date.now()
      ) {
        results.push({
          userId,
          state: "failed",
          message: AUTH_FAILURE_MESSAGE,
        });
        continue;
      }
    } catch {
      results.push({ userId, state: "failed", message: AUTH_FAILURE_MESSAGE });
      continue;
    }

    if (!(await hasActiveAdminSession())) {
      results.push({
        userId,
        state: "cleanup-pending",
        message: IDENTITY_CLEANUP_FAILURE_MESSAGE,
      });
      continue;
    }

    try {
      const cleanupResponse = await adminClient.rpc(
        "cleanup_former_member_auth",
        { p_user_id: userId },
      );
      if (
        cleanupResponse.error ||
        !parseCleanupFormerMemberAuthRpcRow(cleanupResponse.data, userId)
      ) {
        results.push({
          userId,
          state: "cleanup-pending",
          message: IDENTITY_CLEANUP_FAILURE_MESSAGE,
        });
        continue;
      }
    } catch {
      results.push({
        userId,
        state: "cleanup-pending",
        message: IDENTITY_CLEANUP_FAILURE_MESSAGE,
      });
      continue;
    }

    if (!(await hasActiveAdminSession())) {
      results.push({
        userId,
        state: "cleanup-pending",
        message: STORAGE_FAILURE_MESSAGE,
      });
      continue;
    }

    try {
      const { error: storageError } = await adminClient.storage
        .from("avatars")
        .remove([`${userId}/avatar.webp`]);
      if (storageError) {
        results.push({
          userId,
          state: "cleanup-pending",
          message: STORAGE_FAILURE_MESSAGE,
        });
        continue;
      }
    } catch {
      results.push({
        userId,
        state: "cleanup-pending",
        message: STORAGE_FAILURE_MESSAGE,
      });
      continue;
    }

    results.push({
      userId,
      state: "removed",
      message: "Former-member removal completed.",
    });
  }

  return json({ results });
}

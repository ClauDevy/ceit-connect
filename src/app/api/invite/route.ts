import { NextResponse } from "next/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import {
  getNormalizedEmailDomain,
  parseAllowedEmailDomains,
} from "../../../lib/allowed-email-domains";
import {
  createClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";
import { isAuthEmailRateLimit } from "../../../lib/officers/contracts";
import {
  MEMBER_MANAGEMENT_CLEANUP_MESSAGE,
  isUuid,
  safeMemberManagementError,
} from "../../../lib/users/management-contracts";

type AdminClient = Awaited<ReturnType<typeof createServiceRoleClient>>;

const LIVE_OFFICER_INVITE_STATUSES = [
  "preparing",
  "sent",
  "cleanup_pending",
] as const;

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

function isAuthEmailExists(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const authError = error as { code?: unknown; status?: unknown };
  return authError.code === "email_exists" && authError.status === 422;
}

async function hasLiveOfficerInvite(
  adminClient: AdminClient,
  authUserId: string,
  email: string,
) {
  const byAuthUser = await adminClient
    .from("officer_invites")
    .select("id")
    .eq("auth_user_id", authUserId)
    .in("status", LIVE_OFFICER_INVITE_STATUSES)
    .limit(1);
  if (byAuthUser.error) return null;
  if ((byAuthUser.data ?? []).length > 0) return true;

  return hasLiveOfficerInviteByEmail(adminClient, email);
}

async function hasLiveOfficerInviteByEmail(
  adminClient: AdminClient,
  email: string,
) {
  try {
    const byEmail = await adminClient
      .from("officer_invites")
      .select("id")
      .eq("email", email)
      .in("status", LIVE_OFFICER_INVITE_STATUSES)
      .limit(1);
    if (byEmail.error) return null;
    return (byEmail.data ?? []).length > 0;
  } catch {
    return null;
  }
}

async function cleanUpUnfinalizedAuthUser(
  adminClient: AdminClient,
  authUserId: string,
  normalizedEmail: string,
) {
  try {
    const authResult = await adminClient.auth.admin.getUserById(authUserId);
    const authUser = authResult.data.user;
    if (
      authResult.error ||
      !authUser ||
      authUser.email_confirmed_at !== null ||
      authUser.last_sign_in_at !== null
    ) {
      return false;
    }

    const profileResult = await adminClient
      .from("users")
      .select("id")
      .eq("id", authUserId)
      .maybeSingle();
    if (profileResult.error || profileResult.data) return false;

    const hasOfficerInvite = await hasLiveOfficerInvite(
      adminClient,
      authUserId,
      normalizedEmail,
    );
    if (hasOfficerInvite !== false) return false;

    const deletion = await adminClient.auth.admin.deleteUser(authUserId);
    return !deletion.error;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) return json({ error: "Not signed in" }, 401);

  const requester = await getActiveProfileForRoles(["Admin", "Co-Admin"]);
  if (!requester) {
    return json(
      { error: "Only active Admins and Co-Admins can invite members" },
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
  if ("role" in payload) {
    return json({ error: "Role is assigned by the server" }, 400);
  }
  if (
    typeof payload.email !== "string" ||
    typeof payload.fullName !== "string"
  ) {
    return json({ error: "Email and name are required" }, 400);
  }

  const normalizedEmail = payload.email.trim().toLowerCase();
  const normalizedFullName = payload.fullName.trim();
  const emailDomain = getNormalizedEmailDomain(normalizedEmail);
  if (!emailDomain || !normalizedFullName) {
    return json({ error: "Enter a valid email and full name" }, 400);
  }

  const allowedDomains = parseAllowedEmailDomains(
    process.env.ALLOWED_EMAIL_DOMAINS,
  );
  if (allowedDomains.length > 0 && !allowedDomains.includes(emailDomain)) {
    return json(
      {
        error: `Only these email domains can be invited: ${allowedDomains.join(", ")}`,
      },
      400,
    );
  }

  const callerClient = await createClient();
  let committeeId: string | null;
  if (requester.role === "Co-Admin") {
    if ("committeeId" in payload) {
      return json({ error: "Committee is assigned by the server" }, 400);
    }
    if (!requester.committee_id) {
      return json(
        { error: "A committee assignment is required before inviting members" },
        403,
      );
    }
    committeeId = null;
  } else {
    if (!isUuid(payload.committeeId)) {
      return json({ error: "Select a valid committee" }, 400);
    }
    const committeeResult = await callerClient
      .from("committees")
      .select("id")
      .eq("id", payload.committeeId)
      .maybeSingle();
    if (committeeResult.error || !committeeResult.data) {
      return json({ error: "Select a valid committee" }, 400);
    }
    committeeId = payload.committeeId;
  }

  const adminClient = await createServiceRoleClient();
  const hasOfficerInvite = await hasLiveOfficerInviteByEmail(
    adminClient,
    normalizedEmail,
  );
  if (hasOfficerInvite === null) {
    return json(
      { error: "The invitation could not be completed. Try again." },
      500,
    );
  }
  if (hasOfficerInvite) {
    const collision = safeMemberManagementError({ code: "CCM07" });
    return json({ error: collision.message }, collision.status);
  }

  const origin = new URL(request.url).origin;
  let invitedUser: { id: string } | null = null;
  let inviteError: unknown = null;
  try {
    const invited = await adminClient.auth.admin.inviteUserByEmail(
      normalizedEmail,
      { redirectTo: `${origin}/auth/callback` },
    );
    invitedUser = invited.data.user;
    inviteError = invited.error;
  } catch (error) {
    inviteError = error;
  }

  if (inviteError || !invitedUser) {
    if (isAuthEmailRateLimit(inviteError)) {
      return json(
        { error: "Email limit reached. Try again in about an hour." },
        429,
      );
    }
    if (isAuthEmailExists(inviteError)) {
      const collision = safeMemberManagementError({ code: "CCM07" });
      return json({ error: collision.message }, collision.status);
    }
    if (invitedUser) {
      const cleaned = await cleanUpUnfinalizedAuthUser(
        adminClient,
        invitedUser.id,
        normalizedEmail,
      );
      if (!cleaned) return json({ error: MEMBER_MANAGEMENT_CLEANUP_MESSAGE }, 502);
    }
    return json({ error: "The invitation email could not be sent. Try again." }, 500);
  }

  let finalizeError: unknown = null;
  try {
    const finalized = await callerClient.rpc("finalize_member_invite", {
      p_auth_user_id: invitedUser.id,
      p_email: normalizedEmail,
      p_full_name: normalizedFullName,
      p_committee_id: committeeId,
    });
    finalizeError = finalized.error;
  } catch (error) {
    finalizeError = error;
  }

  if (finalizeError) {
    const safe = safeMemberManagementError(
      finalizeError,
      "The invitation could not be completed. Try again.",
    );
    if (safe.code === "CCM06" || safe.code === "CCM07") {
      return json({ error: safe.message }, safe.status);
    }
    const cleaned = await cleanUpUnfinalizedAuthUser(
      adminClient,
      invitedUser.id,
      normalizedEmail,
    );
    if (!cleaned) return json({ error: MEMBER_MANAGEMENT_CLEANUP_MESSAGE }, 502);
    return json({ error: safe.message }, safe.status);
  }

  return json({ success: true });
}

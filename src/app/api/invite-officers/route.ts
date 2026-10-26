import { NextResponse } from "next/server";
import { parseAllowedEmailDomains } from "../../../lib/allowed-email-domains";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import {
  isAuthEmailRateLimit,
  isUuid,
  parseInviteInput,
  safeOfficerError,
  type OfficerInviteInput,
  type OfficerInviteResult,
} from "../../../lib/officers/contracts";
import {
  createClient,
  createServiceRoleClient,
} from "@/lib/supabase/server";

type CallerClient = Awaited<ReturnType<typeof createClient>>;
type AdminClient = Awaited<ReturnType<typeof createServiceRoleClient>>;

type RpcOutcome = {
  outcome?: unknown;
  invite_id?: unknown;
  auth_user_id?: unknown;
  cleanup_action?: unknown;
};

type CleanupResult = {
  complete: boolean;
  action: "none" | "revoke" | "delete_new_attempt" | null;
  authUserId?: string;
  message: string;
};

function result(
  invite: OfficerInviteInput,
  state: OfficerInviteResult["state"],
  message: string,
  additions?: { inviteId?: string | null; authUserId?: string },
): OfficerInviteResult {
  return {
    ...invite,
    inviteId: additions?.inviteId ?? invite.inviteId,
    authUserId: additions?.authUserId,
    state,
    message,
  };
}

async function cancelAndCleanUp(
  callerClient: CallerClient,
  inviteId: string,
  getAdminClient: () => Promise<AdminClient>,
): Promise<CleanupResult> {
  let cancellation: Awaited<ReturnType<CallerClient["rpc"]>>;
  try {
    cancellation = await callerClient.rpc("cancel_officer_invite", {
      p_invite_id: inviteId,
    });
  } catch {
    return {
      complete: false,
      action: null,
      message: "Invitation cleanup still needs attention. Retry it.",
    };
  }
  const { data, error } = cancellation;
  if (error) {
    return {
      complete: false,
      action: null,
      message: safeOfficerError(error).message,
    };
  }

  const cleanup = (data ?? {}) as RpcOutcome;
  const action = cleanup.cleanup_action;
  const authUserId =
    typeof cleanup.auth_user_id === "string" ? cleanup.auth_user_id : undefined;
  if (action === "none") {
    return { complete: true, action, message: "Invitation cancelled." };
  }
  if (
    (action !== "revoke" && action !== "delete_new_attempt") ||
    !authUserId
  ) {
    return {
      complete: false,
      action: null,
      authUserId,
      message: "Invitation cleanup still needs attention. Retry it.",
    };
  }

  let authResult: { error: unknown };
  try {
    const adminClient = await getAdminClient();
    authResult =
      action === "revoke"
        ? await adminClient.auth.admin.updateUserById(authUserId, {
            ban_duration: "876000h",
          })
        : await adminClient.auth.admin.deleteUser(authUserId);
  } catch {
    return {
      complete: false,
      action,
      authUserId,
      message: "Invitation cleanup still needs attention. Retry it.",
    };
  }

  if (authResult.error) {
    return {
      complete: false,
      action,
      authUserId,
      message: "Invitation cleanup still needs attention. Retry it.",
    };
  }

  return { complete: true, action, authUserId, message: "Invitation cancelled." };
}

async function processInvite(
  invite: OfficerInviteInput,
  mode: "send" | "retry",
  callerClient: CallerClient,
  getAdminClient: () => Promise<AdminClient>,
  origin: string,
  allowCleanupRetry = true,
): Promise<{ result: OfficerInviteResult; rateLimited: boolean }> {
  const inviteId = invite.inviteId ?? crypto.randomUUID();
  const { data: preparedData, error: prepareError } = await callerClient.rpc(
    "invite_new_officer",
    {
      p_invite_id: inviteId,
      p_auth_user_id: null,
      p_email: invite.email,
      p_full_name: invite.fullName,
      p_role: invite.role,
      p_committee_id: invite.committeeId,
    },
  );

  if (prepareError) {
    const safe = safeOfficerError(prepareError);
    return {
      result: result(invite, safe.state, safe.message, { inviteId }),
      rateLimited: false,
    };
  }

  const prepared = (preparedData ?? {}) as RpcOutcome;
  const authoritativeInviteId =
    typeof prepared.invite_id === "string" ? prepared.invite_id : inviteId;
  if (prepared.outcome === "sent") {
    return {
      result: result(invite, "sent", "Invitation already sent.", {
        inviteId: authoritativeInviteId,
      }),
      rateLimited: false,
    };
  }
  if (prepared.outcome === "preparing") {
    return {
      result: result(
        invite,
        "unsent",
        "An invitation attempt is already being prepared. Retry after 15 minutes.",
        { inviteId: authoritativeInviteId },
      ),
      rateLimited: false,
    };
  }
  if (prepared.outcome === "cancelled") {
    return {
      result: result(
        invite,
        "failed",
        "This invitation was cancelled and cannot be resent here.",
        { inviteId: authoritativeInviteId },
      ),
      rateLimited: false,
    };
  }
  if (prepared.outcome === "cleanup_pending") {
    if (mode !== "retry" || !allowCleanupRetry) {
      return {
        result: result(
          invite,
          "cleanup-pending",
          "Invitation cleanup is pending. Use Retry unsent.",
          { inviteId: authoritativeInviteId },
        ),
        rateLimited: false,
      };
    }
    const cleanup = await cancelAndCleanUp(
      callerClient,
      authoritativeInviteId,
      getAdminClient,
    );
    if (!cleanup.complete) {
      return {
        result: result(invite, "cleanup-pending", cleanup.message, {
          inviteId: authoritativeInviteId,
          authUserId: cleanup.authUserId,
        }),
        rateLimited: false,
      };
    }
    if (cleanup.action === "revoke") {
      return {
        result: result(
          invite,
          "failed",
          "This cancelled account is retained and cannot be reinvited here.",
          { inviteId: authoritativeInviteId, authUserId: cleanup.authUserId },
        ),
        rateLimited: false,
      };
    }
    return processInvite(
      { ...invite, inviteId: null },
      "retry",
      callerClient,
      getAdminClient,
      origin,
      false,
    );
  }
  if (prepared.outcome !== "prepared") {
    return {
      result: result(
        invite,
        "failed",
        "The invitation could not be prepared. Try again.",
        { inviteId: authoritativeInviteId },
      ),
      rateLimited: false,
    };
  }

  let invited: { user: { id: string } | null } = { user: null };
  let inviteError: unknown = null;
  try {
    const adminClient = await getAdminClient();
    const response = await adminClient.auth.admin.inviteUserByEmail(invite.email, {
      redirectTo: `${origin}/auth/callback`,
    });
    invited = response.data;
    inviteError = response.error;
  } catch (error) {
    inviteError = error;
  }

  if (inviteError || !invited.user) {
    // Auth can create the user before the email provider rejects the send, so
    // every error must reconcile through the database before interpreting it.
    const cleanup = await cancelAndCleanUp(
      callerClient,
      authoritativeInviteId,
      getAdminClient,
    );
    const rateLimited = isAuthEmailRateLimit(inviteError);
    if (!cleanup.complete) {
      return {
        result: result(invite, "cleanup-pending", cleanup.message, {
          inviteId: authoritativeInviteId,
          authUserId: cleanup.authUserId ?? invited.user?.id,
        }),
        rateLimited,
      };
    }
    return {
      result: result(
        invite,
        rateLimited ? "unsent" : "failed",
        rateLimited
          ? "Email limit reached. Try again in about an hour."
          : "The invitation email could not be sent. Retry when ready.",
        {
          inviteId: rateLimited ? invite.inviteId : authoritativeInviteId,
          authUserId: cleanup.authUserId ?? invited.user?.id,
        },
      ),
      rateLimited,
    };
  }

  const { data: finalizedData, error: finalizeError } = await callerClient.rpc(
    "invite_new_officer",
    {
      p_invite_id: authoritativeInviteId,
      p_auth_user_id: invited.user.id,
      p_email: null,
      p_full_name: null,
      p_role: null,
      p_committee_id: null,
    },
  );
  const finalized = (finalizedData ?? {}) as RpcOutcome;
  if (!finalizeError && finalized.outcome === "sent") {
    return {
      result: result(invite, "sent", "Invitation sent.", {
        inviteId: authoritativeInviteId,
        authUserId: invited.user.id,
      }),
      rateLimited: false,
    };
  }

  const cleanup = await cancelAndCleanUp(
    callerClient,
    authoritativeInviteId,
    getAdminClient,
  );
  return {
    result: result(
      invite,
      cleanup.complete ? "failed" : "cleanup-pending",
      cleanup.complete
        ? "The invitation could not be completed. Retry when ready."
        : cleanup.message,
      {
        inviteId: authoritativeInviteId,
        authUserId: cleanup.authUserId ?? invited.user.id,
      },
    ),
    rateLimited: false,
  };
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const requester = await getActiveProfileForRoles(["Admin"]);
  if (!requester) {
    return NextResponse.json(
      { error: "Only active Admins can manage officer invitations" },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const payload = body as Record<string, unknown>;
  const callerClient = await createClient();
  let adminClient: AdminClient | null = null;
  const getAdminClient = async () =>
    (adminClient ??= await createServiceRoleClient());

  if (payload.action === "cancel") {
    if (!isUuid(payload.inviteId)) {
      return NextResponse.json({ error: "Invalid invitation" }, { status: 400 });
    }
    const cleanup = await cancelAndCleanUp(
      callerClient,
      payload.inviteId,
      getAdminClient,
    );
    if (!cleanup.complete) {
      return NextResponse.json(
        {
          state: "cleanup-pending",
          error: cleanup.message,
          authUserId: cleanup.authUserId,
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ state: "cancelled" });
  }

  if (
    (payload.action !== "send" && payload.action !== "retry") ||
    !Array.isArray(payload.invites)
  ) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  if (payload.invites.length < 1 || payload.invites.length > 10) {
    return NextResponse.json(
      { error: "Invite between 1 and 10 officers at a time" },
      { status: 400 },
    );
  }

  const allowedDomains = parseAllowedEmailDomains(
    process.env.ALLOWED_EMAIL_DOMAINS,
  );
  if (allowedDomains.length === 0) {
    return NextResponse.json(
      { error: "Officer invitations are temporarily unavailable" },
      { status: 503 },
    );
  }
  const invites = payload.invites.map((row) =>
    parseInviteInput(row, allowedDomains),
  );
  if (invites.some((row) => row === null)) {
    return NextResponse.json(
      { error: "Check every officer invitation field" },
      { status: 400 },
    );
  }
  const validInvites = invites as OfficerInviteInput[];
  const emails = validInvites.map((row) => row.email);
  if (new Set(emails).size !== emails.length) {
    return NextResponse.json(
      { error: "Each email may appear only once in a batch" },
      { status: 400 },
    );
  }

  const results: OfficerInviteResult[] = [];
  const origin = new URL(request.url).origin;
  let stoppedForRateLimit = false;
  for (const [index, invite] of validInvites.entries()) {
    if (stoppedForRateLimit) {
      results.push(
        result(invite, "unsent", "Not sent because the email limit was reached."),
      );
      continue;
    }
    const processed = await processInvite(
      invite,
      payload.action,
      callerClient,
      getAdminClient,
      origin,
    );
    results.push(processed.result);
    stoppedForRateLimit = processed.rateLimited;
    if (stoppedForRateLimit && index < validInvites.length - 1) continue;
  }

  return NextResponse.json({
    results,
    ...(stoppedForRateLimit
      ? { notice: "Email limit reached. Try again in about an hour." }
      : {}),
  });
}

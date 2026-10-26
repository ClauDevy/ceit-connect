import { NextResponse } from "next/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

  const requester = await getActiveProfileForRoles(["Co-Admin"]);
  if (!requester) {
    return json({ error: "Only active Co-Admins can edit Member names" }, 403);
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
    Object.keys(payload).some((key) => key !== "userId" && key !== "fullName") ||
    !isUuid(payload.userId) ||
    typeof payload.fullName !== "string"
  ) {
    return json({ error: "Check the selected Member and full name" }, 400);
  }

  const supabase = await createClient();
  let data: unknown = null;
  let error: unknown = null;
  try {
    const result = await supabase.rpc("update_committee_member_full_name", {
      p_user_id: payload.userId,
      p_full_name: payload.fullName,
    });
    data = result.data;
    error = result.error;
  } catch (rpcError) {
    error = rpcError;
  }
  if (error) {
    const safe = safeMemberManagementError(error);
    return json({ error: safe.message }, safe.status);
  }
  if (typeof data !== "string") {
    return json(
      { error: "The Member name could not be confirmed. Refresh and try again." },
      500,
    );
  }

  return json({ fullName: data });
}

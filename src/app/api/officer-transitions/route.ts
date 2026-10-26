import { NextResponse } from "next/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { isUuid, safeOfficerError } from "../../../lib/officers/contracts";
import { createClient } from "@/lib/supabase/server";

type TransitionBody =
  | {
      action: "appoint";
      userId: string;
      role: "Admin" | "Co-Admin";
      committeeId: string | null;
    }
  | { action: "return-to-member"; userId: string; committeeId: string }
  | { action: "move-committee"; userId: string; committeeId: string }
  | { action: "step-down"; committeeId: string };

function parseBody(value: unknown): TransitionBody | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (body.action === "appoint") {
    if (
      !isUuid(body.userId) ||
      (body.role !== "Admin" && body.role !== "Co-Admin") ||
      (body.committeeId !== null && !isUuid(body.committeeId)) ||
      (body.role === "Admin" && body.committeeId !== null) ||
      (body.role === "Co-Admin" && !isUuid(body.committeeId))
    )
      return null;
    return {
      action: body.action,
      userId: body.userId,
      role: body.role,
      committeeId: body.committeeId,
    };
  }
  if (body.action === "return-to-member" || body.action === "move-committee") {
    if (!isUuid(body.userId) || !isUuid(body.committeeId)) return null;
    return {
      action: body.action,
      userId: body.userId,
      committeeId: body.committeeId,
    };
  }
  if (body.action === "step-down") {
    if (!isUuid(body.committeeId)) return null;
    return { action: body.action, committeeId: body.committeeId };
  }
  return null;
}

export async function POST(request: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const requester = await getActiveProfileForRoles(["Admin"]);
  if (!requester) {
    return NextResponse.json(
      { error: "Only active Admins can manage officers" },
      { status: 403 },
    );
  }

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const body = parseBody(value);
  if (!body) {
    return NextResponse.json(
      { error: "Check the officer transition details" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const response =
    body.action === "appoint"
      ? await supabase.rpc("appoint_member_as_officer", {
          p_user_id: body.userId,
          p_role: body.role,
          p_committee_id: body.committeeId,
        })
      : body.action === "return-to-member"
        ? await supabase.rpc("return_coadmin_to_member", {
            p_user_id: body.userId,
            p_committee_id: body.committeeId,
          })
        : body.action === "move-committee"
          ? await supabase.rpc("move_member_to_committee", {
              p_user_id: body.userId,
              p_committee_id: body.committeeId,
            })
          : await supabase.rpc("step_down_as_admin", {
              p_committee_id: body.committeeId,
            });

  if (response.error) {
    const safe = safeOfficerError(response.error);
    const status = response.error.code === "CCO01" ? 403 : 409;
    return NextResponse.json({ error: safe.message }, { status });
  }

  return NextResponse.json({
    success: true,
    redirectTo: body.action === "step-down" ? "/home" : undefined,
  });
}

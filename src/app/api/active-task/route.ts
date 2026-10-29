import { NextResponse } from "next/server";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  createActiveTaskRpcArgs,
  editActiveTaskRpcArgs,
  runActiveTaskRpc,
  type CreateActiveTaskRequest,
  type EditActiveTaskRequest,
  validateCreateActiveTaskRequest,
  validateEditActiveTaskRequest,
} from "@/lib/tasks/active-task";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

type RouteProfile = {
  role: "Admin" | "Co-Admin";
  committee_id: string | null;
};

type RouteCheck<T extends object> =
  | ({ ok: true } & T)
  | { ok: false; response: NextResponse };

async function authorize(): Promise<RouteCheck<{ profile: RouteProfile }>> {
  const user = await getAuthUser();
  if (!user) {
    return {
      ok: false,
      response: json({ error: "You must be signed in." }, 401),
    };
  }
  const profile = await getActiveProfileForRoles(["Admin", "Co-Admin"]);
  if (!profile) {
    return {
      ok: false,
      response: json(
        { error: "Only active Admins and Co-Admins can save tasks." },
        403,
      ),
    };
  }
  return { ok: true, profile };
}

async function readJson(
  request: Request,
): Promise<RouteCheck<{ body: unknown }>> {
  try {
    return { ok: true, body: await request.json() as unknown };
  } catch {
    return {
      ok: false,
      response: json({ error: "Invalid request body." }, 400),
    };
  }
}

function committeeDenied(
  profile: { role: string; committee_id: string | null },
  request: CreateActiveTaskRequest | EditActiveTaskRequest,
) {
  return (
    profile.role === "Co-Admin" &&
    (!profile.committee_id || request.committeeId !== profile.committee_id)
  );
}

export async function POST(request: Request) {
  const authorized = await authorize();
  if (!authorized.ok) return authorized.response;
  const parsedJson = await readJson(request);
  if (!parsedJson.ok) return parsedJson.response;
  const validation = validateCreateActiveTaskRequest(parsedJson.body);
  if (!validation.ok) return json({ error: validation.message }, 400);
  const payload = validation.data;
  if (committeeDenied(authorized.profile, payload)) {
    return json({ error: "The task is unavailable." }, 403);
  }

  const supabase = await createClient();
  const result = await runActiveTaskRpc(
    supabase,
    "create_active_event_task",
    createActiveTaskRpcArgs(payload),
  );
  return result.ok
    ? json({ success: true, data: result.data })
    : json({ error: result.message }, result.status);
}

export async function PATCH(request: Request) {
  const authorized = await authorize();
  if (!authorized.ok) return authorized.response;
  const parsedJson = await readJson(request);
  if (!parsedJson.ok) return parsedJson.response;
  const validation = validateEditActiveTaskRequest(parsedJson.body);
  if (!validation.ok) return json({ error: validation.message }, 400);
  const payload = validation.data;
  if (committeeDenied(authorized.profile, payload)) {
    return json({ error: "The task is unavailable." }, 403);
  }

  const supabase = await createClient();
  const result = await runActiveTaskRpc(
    supabase,
    "edit_active_event_task",
    editActiveTaskRpcArgs(payload),
  );
  return result.ok
    ? json({ success: true, data: result.data })
    : json({ error: result.message }, result.status);
}

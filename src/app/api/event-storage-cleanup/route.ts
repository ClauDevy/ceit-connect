import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  countPendingCleanupJobs,
  runEventStorageCleanupPass,
} from "@/lib/events/event-storage-cleanup.server";

export const maxDuration = 30;
const CLEANUP_PASS_TIME_BUDGET_MS = 20_000;

const INVALID_REQUEST_MESSAGE = "Invalid cleanup request.";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

async function activeAdminCaller() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return { ok: false, response: json({ error: "You must be signed in." }, 401) } as const;
  const { data: profile, error } = await supabase
    .from("users")
    .select("role, is_active")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (error) {
    console.error("Failed to verify cleanup caller:", error.code);
    return { ok: false, response: json({ error: "Your account could not be verified. Try again." }, 500) } as const;
  }
  if (!profile || !profile.is_active || profile.role !== "Admin") {
    return { ok: false, response: json({ error: "Only active Admins can manage event cleanup." }, 403) } as const;
  }
  return { ok: true, userId: auth.user.id } as const;
}

export async function POST(request: Request) {
  let caller: Awaited<ReturnType<typeof activeAdminCaller>>;
  try {
    caller = await activeAdminCaller();
  } catch {
    return json({ error: "Your account could not be verified. Try again." }, 500);
  }
  if (!caller.ok) return caller.response;

  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return json({ error: INVALID_REQUEST_MESSAGE }, 400);
  }
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).length !== 1 || Object.keys(value)[0] !== "action"
  ) {
    return json({ error: INVALID_REQUEST_MESSAGE }, 400);
  }
  const action = (value as { action?: unknown }).action;
  if (action !== "status" && action !== "retry") {
    return json({ error: INVALID_REQUEST_MESSAGE }, 400);
  }

  let service: Awaited<ReturnType<typeof createServiceRoleClient>>;
  try {
    service = await createServiceRoleClient();
  } catch {
    return json({ error: "Event cleanup could not be loaded. Try again." }, 500);
  }
  try {
    if (action === "status") {
      return json({ pendingCount: await countPendingCleanupJobs(service) });
    }
    const pass = await runEventStorageCleanupPass(service, {
      timeBudgetMs: CLEANUP_PASS_TIME_BUDGET_MS,
    });
    const pendingCount = await countPendingCleanupJobs(service);
    return json({ ...pass, pendingCount });
  } catch {
    return json({ error: "Event cleanup could not be loaded. Try again." }, 500);
  }
}

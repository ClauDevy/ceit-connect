import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  EVENT_DELETION_MAX_DURATION_SECONDS,
  PRE_DELETION_CLEANUP_BUDGET_MS,
  deletionErrorMessage,
  parseEventDeletionRequest,
  type EventDeletionResult,
} from "@/lib/events/event-deletion";
import {
  attemptEventStorageCleanup,
  countPendingCleanupJobs,
  runEventStorageCleanupPass,
} from "@/lib/events/event-storage-cleanup.server";

export const maxDuration = EVENT_DELETION_MAX_DURATION_SECONDS;

type StoredEvent = {
  id: string;
  name: string;
  status: string;
  updated_at: string;
};

type DeleteRpcRow = {
  out_event_id: string;
  out_cleanup_job_id: string | null;
  out_cleanup_unavailable: boolean;
};

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
    console.error("Failed to verify event deletion caller:", error.code);
    return { ok: false, response: json({ error: "Your account could not be verified. Try again." }, 500) } as const;
  }
  if (!profile || !profile.is_active || profile.role !== "Admin") {
    return { ok: false, response: json({ error: "Only active Admins can delete events." }, 403) } as const;
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
    return json({ error: "Invalid deletion request." }, 400);
  }
  const body = parseEventDeletionRequest(value);
  if (!body) return json({ error: "Invalid deletion request." }, 400);

  let service: Awaited<ReturnType<typeof createServiceRoleClient>>;
  try {
    service = await createServiceRoleClient();
  } catch {
    return json({ error: "The deletion service is unavailable. Try again." }, 500);
  }
  const ids = body.events.map((event) => event.id);
  let storedRows: unknown;
  let storedError: { code?: string } | null;
  try {
    const stored = await service
      .from("events")
      .select("id, name, status, updated_at")
      .in("id", ids);
    storedRows = stored.data;
    storedError = stored.error;
  } catch {
    return json({ error: "The selected events could not be verified. Try again." }, 500);
  }
  if (storedError) {
    console.error("Failed to verify selected events:", storedError.code);
    return json({ error: "The selected events could not be verified. Try again." }, 500);
  }
  const storedById = new Map(
    ((storedRows ?? []) as StoredEvent[]).map((event) => [event.id.toLowerCase(), event]),
  );

  const requiredConfirmation = body.events.length === 1
    ? storedById.get(body.events[0].id.toLowerCase())?.name
    : `DELETE ${body.events.length} EVENTS`;
  if (requiredConfirmation !== undefined && body.confirmation !== requiredConfirmation) {
    return json({ error: "The typed confirmation does not match." }, 400);
  }

  let preCleanup = { attempted: 0, done: 0, failed: 0, timedOut: false };
  try {
    preCleanup = await runEventStorageCleanupPass(service, {
      timeBudgetMs: PRE_DELETION_CLEANUP_BUDGET_MS,
    });
  } catch {
    console.error("Pre-deletion event cleanup pass failed.");
  }

  const results: EventDeletionResult[] = [];
  for (const submitted of body.events) {
    const stored = storedById.get(submitted.id.toLowerCase());
    if (!stored) {
      results.push({
        eventId: submitted.id,
        eventName: null,
        deletion: "failed",
        cleanup: "done",
        cleanupWarning: false,
        message: deletionErrorMessage("CCE03"),
      });
      continue;
    }
    if (stored.updated_at !== submitted.expectedUpdatedAt) {
      results.push({
        eventId: submitted.id,
        eventName: stored.name,
        deletion: "failed",
        cleanup: "done",
        cleanupWarning: false,
        message: deletionErrorMessage("CCE05"),
      });
      continue;
    }

    let deletion;
    try {
      deletion = await service.rpc("delete_event", {
        p_event_id: submitted.id,
        p_actor_id: caller.userId,
        // Keep the opaque database string intact. Date would lose microseconds.
        p_expected_updated_at: submitted.expectedUpdatedAt,
      });
    } catch {
      results.push({
        eventId: submitted.id,
        eventName: stored.name,
        deletion: "failed",
        cleanup: "done",
        cleanupWarning: false,
        message: deletionErrorMessage(undefined),
      });
      continue;
    }
    if (deletion.error) {
      results.push({
        eventId: submitted.id,
        eventName: stored.name,
        deletion: "failed",
        cleanup: "done",
        cleanupWarning: false,
        message: deletionErrorMessage(deletion.error.code),
      });
      continue;
    }

    const row = Array.isArray(deletion.data)
      ? (deletion.data[0] as DeleteRpcRow | undefined)
      : undefined;
    if (!row) {
      results.push({
        eventId: submitted.id,
        eventName: stored.name,
        deletion: "failed",
        cleanup: "done",
        cleanupWarning: false,
        message: deletionErrorMessage(undefined),
      });
      continue;
    }

    let cleanup: EventDeletionResult["cleanup"] = "done";
    let cleanupMessage = "Event deleted.";
    if (row.out_cleanup_job_id) {
      let attempt;
      try {
        attempt = await attemptEventStorageCleanup(service, row.out_cleanup_job_id);
      } catch {
        attempt = { status: "pending" as const };
      }
      cleanup = attempt.status;
      cleanupMessage = cleanup === "done"
        ? "Event deleted and banner cleanup completed."
        : cleanup === "failed"
          ? "Event deleted. Banner cleanup failed and can be retried."
          : "Event deleted. Banner cleanup remains pending.";
    }
    if (row.out_cleanup_unavailable) {
      cleanupMessage = "Event deleted. Its stored banner could not be queued for cleanup.";
    }
    results.push({
      eventId: submitted.id,
      eventName: stored.name,
      deletion: "done",
      cleanup,
      cleanupWarning: row.out_cleanup_unavailable,
      message: cleanupMessage,
    });
  }

  let pendingCount: number | null = null;
  try {
    pendingCount = await countPendingCleanupJobs(service);
  } catch {
    console.error("Failed to refresh event cleanup count after deletion.");
  }
  return json({ results, pendingCount, preCleanup });
}

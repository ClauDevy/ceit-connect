import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import {
  deletionErrorMessage,
  parseEventDeletionRequest,
  type EventDeletionResult,
} from "@/lib/events/event-deletion";
import { PRE_DELETION_CLEANUP_BUDGET_MS } from "@/lib/events/event-deletion-limits";
import {
  attemptEventStorageCleanup,
  countPendingCleanupJobs,
  runEventStorageCleanupPass,
} from "@/lib/events/event-storage-cleanup.server";

// must stay a literal for Next static analysis; equals EVENT_DELETION_ROUTE_MAX_DURATION_SECONDS in event-deletion-limits.ts.
export const maxDuration = 60;

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
  out_error_code: string | null;
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

  const resultById = new Map<string, EventDeletionResult>();
  const eligible: Array<{ id: string; expectedUpdatedAt: string }> = [];
  for (const submitted of body.events) {
    const stored = storedById.get(submitted.id.toLowerCase());
    if (!stored) {
      resultById.set(submitted.id.toLowerCase(), {
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
      resultById.set(submitted.id.toLowerCase(), {
        eventId: submitted.id,
        eventName: stored.name,
        deletion: "failed",
        cleanup: "done",
        cleanupWarning: false,
        message: deletionErrorMessage("CCE05"),
      });
      continue;
    }
    eligible.push(submitted);
  }

  let deletionRows: DeleteRpcRow[] = [];
  if (eligible.length > 0) {
    let deletion;
    try {
      deletion = await service.rpc("delete_events_bulk", {
        p_events: eligible.map((event) => ({
          id: event.id,
          expected_updated_at: event.expectedUpdatedAt,
        })),
        p_actor_id: caller.userId,
      });
    } catch {
      deletion = { data: null, error: { code: undefined } };
    }
    if (deletion.error) {
      for (const submitted of eligible) {
        const stored = storedById.get(submitted.id.toLowerCase());
        resultById.set(submitted.id.toLowerCase(), {
          eventId: submitted.id,
          eventName: stored?.name ?? null,
          deletion: "failed",
          cleanup: "done",
          cleanupWarning: false,
          message: deletionErrorMessage(deletion.error.code),
        });
      }
    } else if (Array.isArray(deletion.data)) {
      deletionRows = deletion.data as DeleteRpcRow[];
    }
  }

  const deletionById = new Map(
    deletionRows.map((row) => [row.out_event_id.toLowerCase(), row]),
  );
  for (const submitted of eligible) {
    if (resultById.has(submitted.id.toLowerCase())) continue;
    const stored = storedById.get(submitted.id.toLowerCase());
    const row = deletionById.get(submitted.id.toLowerCase());
    if (!row) {
      resultById.set(submitted.id.toLowerCase(), {
        eventId: submitted.id,
        eventName: stored?.name ?? null,
        deletion: "failed",
        cleanup: "done",
        cleanupWarning: false,
        message: deletionErrorMessage(undefined),
      });
      continue;
    }
    if (row.out_error_code) {
      resultById.set(submitted.id.toLowerCase(), {
        eventId: submitted.id,
        eventName: stored?.name ?? null,
        deletion: "failed",
        cleanup: "done",
        cleanupWarning: false,
        message: deletionErrorMessage(row.out_error_code),
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
    resultById.set(submitted.id.toLowerCase(), {
      eventId: submitted.id,
      eventName: stored?.name ?? null,
      deletion: "done",
      cleanup,
      cleanupWarning: row.out_cleanup_unavailable,
      message: cleanupMessage,
    });
  }

  const results = body.events.map((submitted) =>
    resultById.get(submitted.id.toLowerCase()) ?? {
      eventId: submitted.id,
      eventName: storedById.get(submitted.id.toLowerCase())?.name ?? null,
      deletion: "failed" as const,
      cleanup: "done" as const,
      cleanupWarning: false,
      message: deletionErrorMessage(undefined),
    },
  );

  let pendingCount: number | null = null;
  try {
    pendingCount = await countPendingCleanupJobs(service);
  } catch {
    console.error("Failed to refresh event cleanup count after deletion.");
  }
  return json({ results, pendingCount, preCleanup });
}

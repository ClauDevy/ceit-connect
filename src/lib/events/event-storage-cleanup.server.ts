import type { createServiceRoleClient } from "@/lib/supabase/server";
import { CLEANUP_RETRY_LIMIT } from "@/lib/events/event-deletion-limits";
import { deletionErrorMessage } from "@/lib/events/event-deletion";

type ServiceClient = Awaited<ReturnType<typeof createServiceRoleClient>>;

type ClaimedCleanupJob = {
  out_job_id: string;
  out_event_id: string;
  out_bucket_id: string;
  out_object_path: string;
  out_claim_token: string;
};

export type CleanupAttemptResult = {
  jobId: string | null;
  status: "done" | "pending" | "failed";
  message: string;
};

export type CleanupPassResult = {
  attempted: number;
  done: number;
  failed: number;
  timedOut: boolean;
};

const CLEANUP_FAILED_LEDGER_MESSAGE = "Storage cleanup failed.";

export async function countPendingCleanupJobs(client: ServiceClient) {
  const { data, error } = await client.rpc("count_event_storage_cleanup_jobs");
  if (error || typeof data !== "number" || !Number.isSafeInteger(data) || data < 0) {
    if (error) console.error("Failed to count event cleanup jobs:", error.code);
    throw new Error("CLEANUP_COUNT_FAILED");
  }
  return data;
}

export async function attemptEventStorageCleanup(
  client: ServiceClient,
  jobId: string | null,
): Promise<CleanupAttemptResult> {
  let claim;
  try {
    claim = await client.rpc("claim_event_storage_cleanup_job", {
      p_job_id: jobId,
    });
  } catch {
    console.error("Failed to claim event cleanup job: request_failed");
    return { jobId, status: "pending", message: "Banner cleanup remains pending." };
  }
  if (claim.error) {
    console.error("Failed to claim event cleanup job:", claim.error.code);
    return {
      jobId,
      status: "pending",
      message: deletionErrorMessage(claim.error.code),
    };
  }

  const job = Array.isArray(claim.data)
    ? (claim.data[0] as ClaimedCleanupJob | undefined)
    : undefined;
  if (!job) {
    return { jobId, status: "pending", message: "Banner cleanup remains pending." };
  }

  let storageFailed = false;
  try {
    const { error } = await client.storage
      .from(job.out_bucket_id)
      .remove([job.out_object_path]);
    storageFailed = Boolean(error);
    if (error) console.error("Event banner cleanup failed: storage_error");
  } catch {
    storageFailed = true;
    console.error("Event banner cleanup failed: storage_exception");
  }

  const outcome = storageFailed ? "failed" : "done";
  let finalized;
  try {
    finalized = await client.rpc("finalize_event_storage_cleanup_job", {
      p_job_id: job.out_job_id,
      p_claim_token: job.out_claim_token,
      p_outcome: outcome,
      p_last_error: storageFailed ? CLEANUP_FAILED_LEDGER_MESSAGE : null,
    });
  } catch {
    console.error("Failed to finalize event cleanup job: request_failed");
    return { jobId: job.out_job_id, status: "pending", message: "Banner cleanup remains pending." };
  }

  if (finalized.error) {
    console.error("Failed to finalize event cleanup job:", finalized.error.code);
    return {
      jobId: job.out_job_id,
      status: "pending",
      message: deletionErrorMessage(finalized.error.code),
    };
  }
  if (finalized.data !== true) {
    return {
      jobId: job.out_job_id,
      status: "pending",
      message: "Banner cleanup remains pending.",
    };
  }
  return {
    jobId: job.out_job_id,
    status: outcome,
    message: storageFailed ? "Banner cleanup failed and can be retried." : "Banner cleanup completed.",
  };
}

function budgetedAttempt(
  attempt: Promise<CleanupAttemptResult>,
  remainingMs: number,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), remainingMs);
  });
  return Promise.race([attempt, timedOut]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

export async function runEventStorageCleanupPass(
  client: ServiceClient,
  options: { limit?: number; timeBudgetMs?: number } = {},
): Promise<CleanupPassResult> {
  const limit = Math.min(options.limit ?? CLEANUP_RETRY_LIMIT, CLEANUP_RETRY_LIMIT);
  const timeBudgetMs = options.timeBudgetMs ?? Number.POSITIVE_INFINITY;
  const deadline = Number.isFinite(timeBudgetMs) ? Date.now() + timeBudgetMs : Number.POSITIVE_INFINITY;
  let attempted = 0;
  let done = 0;
  let failed = 0;

  while (attempted < limit) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return { attempted, done, failed, timedOut: true };

    const attempt = attemptEventStorageCleanup(client, null);
    const result = Number.isFinite(remainingMs)
      ? await budgetedAttempt(attempt, remainingMs)
      : await attempt;
    if (!result) {
      void attempt.catch(() => undefined);
      return { attempted, done, failed, timedOut: true };
    }
    if (result.jobId === null) break;
    attempted += 1;
    if (result.status === "done") done += 1;
    if (result.status === "failed") failed += 1;
  }

  return { attempted, done, failed, timedOut: false };
}

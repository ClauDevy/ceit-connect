import "server-only";

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  type ImportantEmailConfig,
} from "@/lib/email/important-email-worker";
import {
  isValidMailbox,
  sendResendEmail,
  type EmailAttachment,
  type EmailSendOutcome,
} from "@/lib/email/resend-sender";
import { escapeActivityCsvCell } from "@/lib/activity-log-admin";

export const ACTIVITY_BACKUP_BUCKET = "activity-log-backups";
export const ACTIVITY_BACKUP_MAX_ROWS = 5_000;
export const ACTIVITY_BACKUP_MAX_BYTES = 5 * 1024 * 1024;
export const ACTIVITY_BACKUP_MAX_FILES_PER_WAKE = 4;
export const ACTIVITY_BACKUP_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const ACTIVITY_BACKUP_DATABASE_TIMEOUT_MS = 30_000;

export type ActivityBackupLimits = {
  maxRows: number;
  maxBytes: number;
  maxFilesPerWake: number;
  maxAttachmentBytes: number;
};

const DEFAULT_LIMITS: ActivityBackupLimits = {
  maxRows: ACTIVITY_BACKUP_MAX_ROWS,
  maxBytes: ACTIVITY_BACKUP_MAX_BYTES,
  maxFilesPerWake: ACTIVITY_BACKUP_MAX_FILES_PER_WAKE,
  maxAttachmentBytes: ACTIVITY_BACKUP_MAX_ATTACHMENT_BYTES,
};

type ClaimedBackup = {
  out_backup_id: string;
  out_kind: "monthly_retention" | "manual_before_date" | "manual_all";
  out_status: "snapshotting" | "deleting" | "email_pending";
  out_fixed_cutoff_at: string;
  out_lease_token: string;
};

type CandidateRow = {
  activity_id: string;
  activity_created_at: string;
  action: string;
  task_title: string;
  event_name: string | null;
  committee_name: string | null;
  actor_name: string | null;
  change_summary: string;
};

type PreparedBackupEmail = {
  out_recipients: string[];
  out_file_ids: string[];
  out_object_paths: string[];
  out_filenames: string[];
};

export async function activityBackupFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ACTIVITY_BACKUP_DATABASE_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const body = await response.arrayBuffer();
    const bodyless = [204, 205, 304].includes(response.status);
    return new Response(bodyless ? null : body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } finally {
    clearTimeout(timer);
  }
}

function createBackupClient(config: ImportantEmailConfig) {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      fetch: activityBackupFetch,
      headers: { "x-ceit-email-capability": config.capability },
    },
  });
}

function isClaimedBackup(value: unknown): value is ClaimedBackup {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.out_backup_id === "string" &&
    typeof row.out_lease_token === "string" &&
    typeof row.out_fixed_cutoff_at === "string" &&
    ["monthly_retention", "manual_before_date", "manual_all"].includes(String(row.out_kind)) &&
    ["snapshotting", "deleting", "email_pending"].includes(String(row.out_status));
}

function isCandidate(value: unknown): value is CandidateRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.activity_id === "string" &&
    typeof row.activity_created_at === "string" &&
    typeof row.action === "string" &&
    typeof row.task_title === "string" &&
    (row.event_name === null || typeof row.event_name === "string") &&
    (row.committee_name === null || typeof row.committee_name === "string") &&
    (row.actor_name === null || typeof row.actor_name === "string") &&
    typeof row.change_summary === "string";
}

function csvLine(cells: readonly (string | null)[]) {
  return `${cells.map(escapeActivityCsvCell).join(",")}\r\n`;
}

export function buildBoundedActivityBackupCsv(
  candidates: readonly CandidateRow[],
  limits: Pick<ActivityBackupLimits, "maxRows" | "maxBytes"> = DEFAULT_LIMITS,
) {
  const encoder = new TextEncoder();
  const header = `\uFEFF${csvLine([
    "Date/time", "Action", "Task", "Event", "Committee", "Actor", "Change summary",
  ])}`;
  const lines = [header];
  let byteLength = encoder.encode(header).byteLength;
  const included: CandidateRow[] = [];
  for (const row of candidates.slice(0, limits.maxRows)) {
    const line = csvLine([
      row.activity_created_at,
      row.action,
      row.task_title,
      row.event_name,
      row.committee_name,
      row.actor_name,
      row.change_summary,
    ]);
    const lineByteLength = encoder.encode(line).byteLength;
    if (byteLength + lineByteLength > limits.maxBytes) break;
    lines.push(line);
    byteLength += lineByteLength;
    included.push(row);
  }
  if (candidates.length && !included.length) {
    throw new Error("activity backup row exceeds file cap");
  }
  return { bytes: encoder.encode(lines.join("")), rows: included };
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function uploadBackupFile(
  client: SupabaseClient,
  path: string,
  bytes: Uint8Array,
) {
  const bucket = client.storage.from(ACTIVITY_BACKUP_BUCKET);
  const upload = await bucket.upload(path, bytes, {
    contentType: "text/csv",
    upsert: false,
  });
  return !upload.error;
}

async function releaseLease(
  client: SupabaseClient,
  claim: ClaimedBackup,
  errorCode: string,
) {
  await client.rpc("release_activity_log_backup_lease", {
    p_backup_id: claim.out_backup_id,
    p_lease_token: claim.out_lease_token,
    p_error_code: errorCode,
  });
}

async function snapshotBackup(
  client: SupabaseClient,
  claim: ClaimedBackup,
  limits: ActivityBackupLimits,
) {
  for (let part = 0; part < limits.maxFilesPerWake; part += 1) {
    const candidatesResult = await client.rpc("list_activity_log_backup_candidates", {
      p_backup_id: claim.out_backup_id,
      p_lease_token: claim.out_lease_token,
      p_limit: limits.maxRows,
    });
    if (candidatesResult.error || !Array.isArray(candidatesResult.data)) {
      throw new Error("candidate read failed");
    }
    const candidates = candidatesResult.data.filter(isCandidate);
    if (!candidates.length) {
      const completed = await client.rpc("complete_activity_log_backup_snapshot", {
        p_backup_id: claim.out_backup_id,
        p_lease_token: claim.out_lease_token,
      });
      if (completed.error || completed.data !== true) throw new Error("snapshot completion failed");
      return;
    }
    const csv = buildBoundedActivityBackupCsv(candidates, limits);
    const reservation = await client.rpc("reserve_activity_log_backup_file", {
      p_backup_id: claim.out_backup_id,
      p_lease_token: claim.out_lease_token,
      p_activity_ids: csv.rows.map((row) => row.activity_id),
    });
    const reserved = Array.isArray(reservation.data) ? reservation.data[0] as Record<string, unknown> : null;
    if (reservation.error || !reserved || typeof reserved.out_file_id !== "string" ||
      typeof reserved.out_object_path !== "string") {
      throw new Error("file reservation failed");
    }
    if (!await uploadBackupFile(client, reserved.out_object_path, csv.bytes)) {
      throw new Error("file upload failed");
    }
    const verified = await client.rpc("verify_activity_log_backup_file", {
      p_file_id: reserved.out_file_id,
      p_backup_id: claim.out_backup_id,
      p_lease_token: claim.out_lease_token,
      p_raw_byte_count: csv.bytes.byteLength,
      p_sha256_hex: sha256(csv.bytes),
      p_file_bytes_base64: Buffer.from(csv.bytes).toString("base64"),
    });
    if (verified.error || verified.data !== true) throw new Error("file verification failed");
  }
}

async function deleteBackupBatch(client: SupabaseClient, claim: ClaimedBackup) {
  const result = await client.rpc("run_activity_log_backup_delete_batch", {
    p_backup_id: claim.out_backup_id,
    p_lease_token: claim.out_lease_token,
  });
  if (result.error || typeof result.data !== "number") throw new Error("backup deletion failed");
}

function isPreparedEmail(value: unknown): value is PreparedBackupEmail {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return Array.isArray(row.out_recipients) && row.out_recipients.every(isValidMailbox) &&
    Array.isArray(row.out_file_ids) && row.out_file_ids.every((id) => typeof id === "string") &&
    Array.isArray(row.out_object_paths) && row.out_object_paths.every((path) => typeof path === "string") &&
    Array.isArray(row.out_filenames) && row.out_filenames.every((name) => typeof name === "string") &&
    row.out_file_ids.length === row.out_filenames.length &&
    row.out_object_paths.length === row.out_filenames.length;
}

export async function sendBackupEmail(
  client: SupabaseClient,
  config: ImportantEmailConfig,
  claim: ClaimedBackup,
  limits: ActivityBackupLimits,
) {
  const preparedResult = await client.rpc("prepare_activity_log_backup_email", {
    p_backup_id: claim.out_backup_id,
    p_lease_token: claim.out_lease_token,
  });
  const prepared = Array.isArray(preparedResult.data) ? preparedResult.data[0] : null;
  let outcome: EmailSendOutcome = preparedResult.error
    ? { outcome: "transient", httpStatus: null }
    : { outcome: "permanent", httpStatus: 400 };
  if (!preparedResult.error && isPreparedEmail(prepared) && prepared.out_recipients.length) {
    const attachments: EmailAttachment[] = [];
    let attachedBytes = 0;
    let attachmentDownloadFailed = false;
    let firstOmittedIndex = prepared.out_object_paths.length;
    for (let index = 0; index < prepared.out_object_paths.length; index += 1) {
      if (attachments.length >= 4) {
        firstOmittedIndex = index;
        break;
      }
      const payload = await client.rpc("read_activity_log_backup_file_payload", {
        p_backup_id: claim.out_backup_id,
        p_file_id: prepared.out_file_ids[index],
        p_lease_token: claim.out_lease_token,
      });
      if (payload.error || typeof payload.data !== "string") {
        attachmentDownloadFailed = true;
        break;
      }
      const content = new Uint8Array(Buffer.from(payload.data, "base64"));
      if (attachedBytes + content.byteLength > limits.maxAttachmentBytes) {
        firstOmittedIndex = index;
        break;
      }
      attachedBytes += content.byteLength;
      attachments.push({
        filename: prepared.out_filenames[index],
        content,
        contentType: "text/csv",
      });
    }
    if (attachmentDownloadFailed) {
      outcome = { outcome: "transient", httpStatus: null };
    } else {
      const backupUrl = new URL("/activity-log", `${config.siteUrl}/`).toString();
      const extra = prepared.out_filenames.slice(firstOmittedIndex);
      const extraText = extra.length
        ? `\n\nAdditional stored files:\n${extra.map((name) => `- ${name}`).join("\n")}\nDownload them in CEIT Connect: ${backupUrl}`
        : `\n\nBackups: ${backupUrl}`;
      outcome = await sendResendEmail(config.apiKey, {
        from: config.from,
        to: prepared.out_recipients,
        idempotencyKey: claim.out_backup_id,
        subject: "CEIT Connect Activity Log backup",
        text: `Activity Log entries were backed up before deletion.${extraText}`,
        html: `<p>Activity Log entries were backed up before deletion.</p>${
          extra.length ? `<p>Additional stored files:</p><ul>${extra.map((name) => `<li>${name}</li>`).join("")}</ul>` : ""
        }<p><a href="${backupUrl}">Open Activity Log backups</a></p>`,
        attachments,
      });
    }
  }
  const acknowledged = await client.rpc("acknowledge_activity_log_backup_email", {
    p_backup_id: claim.out_backup_id,
    p_lease_token: claim.out_lease_token,
    p_outcome: outcome.outcome,
    p_http_status: outcome.httpStatus,
  });
  if (acknowledged.error || acknowledged.data !== true) throw new Error("backup email acknowledgement failed");
}

export async function runActivityLogBackupDelivery(
  config: ImportantEmailConfig,
  injectedLimits: Partial<ActivityBackupLimits> = {},
) {
  const limits = { ...DEFAULT_LIMITS, ...injectedLimits };
  const counts = { claimed: 0, files: 0, deleted: 0, emailed: 0, failures: 0 };
  const client = createBackupClient(config);
  const claimed = await client.rpc("claim_activity_log_backup");
  if (claimed.error || !Array.isArray(claimed.data) || !claimed.data.length) return counts;
  const claim = claimed.data.find(isClaimedBackup);
  if (!claim) return counts;
  counts.claimed = 1;
  try {
    if (claim.out_status === "snapshotting") {
      await snapshotBackup(client, claim, limits);
    } else if (claim.out_status === "deleting") {
      await deleteBackupBatch(client, claim);
    } else {
      await sendBackupEmail(client, config, claim, limits);
      counts.emailed = 1;
    }
  } catch {
    counts.failures = 1;
    await releaseLease(client, claim, "backup_worker_failed");
  }
  console.info("Activity Log backup delivery finished.", counts);
  return counts;
}

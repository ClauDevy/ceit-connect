import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  isValidFrom,
  isValidMailbox,
  RESEND_TIMEOUT_MS,
  sendResendEmail,
  type EmailMessage,
  type EmailSendOutcome,
} from "@/lib/email/resend-sender";

export const EMAIL_CLAIM_LIMIT = 10;
export const EMAIL_CONCURRENCY = 2;
export const EMAIL_DATABASE_TIMEOUT_MS = 2_000;

export type ImportantEmailConfig = {
  anonKey: string;
  apiKey: string;
  capability: string;
  from: string;
  siteUrl: string;
  supabaseUrl: string;
};

export type ClaimedEmailDelivery = {
  out_attempt: number;
  out_delivery_id: string;
  out_lease_expires_at: string;
  out_lease_token: string;
  out_notification_type: "assignment" | "task_due_soon" | "live_operation_prep";
  out_run_id: string;
  out_run_token: string;
};

export type PreparedEmailDelivery = ClaimedEmailDelivery & {
  out_is_confidential: boolean;
  out_recipient_email: string;
  out_send_guard_expires_at: string;
  out_target_path: string;
  out_task_title: string | null;
};

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error("Important email configuration is unavailable.");
  return value;
}

function validatedSiteUrl(value: string) {
  const url = new URL(value);
  if (
    url.username || url.password || url.search || url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) throw new Error("Important email configuration is unavailable.");
  const localHttp = process.env.NODE_ENV !== "production" &&
    url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  if (url.protocol !== "https:" && !localHttp) {
    throw new Error("Important email configuration is unavailable.");
  }
  return url.origin;
}

export function prepareImportantEmailSender(): ImportantEmailConfig {
  const from = requiredEnv("EMAIL_FROM");
  if (!isValidFrom(from)) throw new Error("Important email configuration is unavailable.");
  return {
    anonKey: requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    apiKey: requiredEnv("RESEND_API_KEY"),
    capability: requiredEnv("EMAIL_DB_CAPABILITY"),
    from,
    siteUrl: validatedSiteUrl(requiredEnv("EMAIL_SITE_URL")),
    supabaseUrl: requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  };
}

export async function databaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_DATABASE_TIMEOUT_MS);
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

function createEmailDatabaseClient(config: ImportantEmailConfig) {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: {
      fetch: databaseFetch,
      headers: { "x-ceit-email-capability": config.capability },
    },
  });
}

export async function emailDatabaseReady(config: ImportantEmailConfig) {
  const { data, error } = await createEmailDatabaseClient(config).rpc("email_sender_ready");
  return !error && data === true;
}

function isClaimedEmail(value: unknown): value is ClaimedEmailDelivery {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.out_delivery_id === "string" &&
    typeof row.out_lease_token === "string" &&
    typeof row.out_run_id === "string" && typeof row.out_run_token === "string" &&
    ["assignment", "task_due_soon", "live_operation_prep"].includes(String(row.out_notification_type)) &&
    typeof row.out_attempt === "number" && typeof row.out_lease_expires_at === "string";
}

function isPreparedEmail(value: unknown): value is Omit<PreparedEmailDelivery, keyof ClaimedEmailDelivery> & {
  out_notification_type: ClaimedEmailDelivery["out_notification_type"];
} {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.out_recipient_email === "string" && isValidMailbox(row.out_recipient_email) &&
    ["assignment", "task_due_soon", "live_operation_prep"].includes(String(row.out_notification_type)) &&
    typeof row.out_target_path === "string" && typeof row.out_is_confidential === "boolean" &&
    (row.out_task_title === null || typeof row.out_task_title === "string") &&
    typeof row.out_send_guard_expires_at === "string" &&
    Number.isFinite(Date.parse(row.out_send_guard_expires_at));
}

export function escapeEmailHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function safeTitle(value: string | null) {
  return value?.replace(/[\r\n\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200) || null;
}

export function buildImportantEmail(
  config: ImportantEmailConfig,
  delivery: PreparedEmailDelivery,
): EmailMessage {
  const title = delivery.out_is_confidential ? null : safeTitle(delivery.out_task_title);
  const targetPath = delivery.out_is_confidential ? "/workspace" : delivery.out_target_path;
  if (!delivery.out_is_confidential && (!title || !/^\/tasks\/[0-9a-f-]+$/i.test(targetPath))) {
    throw new Error("Important email delivery content is invalid.");
  }
  const targetUrl = new URL(targetPath, `${config.siteUrl}/`).toString();
  const settingsUrl = new URL("/settings", `${config.siteUrl}/`).toString();
  const copy = delivery.out_notification_type === "assignment"
    ? title ? { subject: `New task assignment: ${title}`, body: `You were assigned to “${title}”.` }
      : { subject: "New confidential task assignment", body: "You were assigned to a confidential task." }
    : delivery.out_notification_type === "task_due_soon"
      ? title ? { subject: `Task due soon: ${title}`, body: `“${title}” is due soon.` }
        : { subject: "Confidential task due soon", body: "A confidential task is due soon." }
      : title ? { subject: `Live Operation reminder: ${title}`, body: `Call time for “${title}” is coming soon.` }
        : { subject: "Confidential Live Operation reminder", body: "A confidential Live Operation call time is coming soon." };
  const action = delivery.out_is_confidential ? "Open My Tasks" : "View task";
  const footer = "Replies to this email are not monitored. You can turn these emails off in Settings.";
  return {
    from: config.from,
    to: delivery.out_recipient_email,
    idempotencyKey: delivery.out_delivery_id,
    subject: copy.subject,
    text: `${copy.body}\n\n${action}: ${targetUrl}\n\n${footer}\nSettings: ${settingsUrl}`,
    html: `<p>${escapeEmailHtml(copy.body)}</p><p><a href="${escapeEmailHtml(targetUrl)}">${action}</a></p><p>${escapeEmailHtml(footer)} <a href="${escapeEmailHtml(settingsUrl)}">Settings</a></p>`,
  };
}

async function acknowledge(
  client: SupabaseClient,
  delivery: ClaimedEmailDelivery,
  outcome: EmailSendOutcome,
) {
  const { data, error } = await client.rpc("acknowledge_email_delivery", {
    p_delivery_id: delivery.out_delivery_id,
    p_lease_token: delivery.out_lease_token,
    p_outcome: outcome.outcome,
    p_http_status: outcome.httpStatus,
  });
  return !error && data === true;
}

async function prepareDelivery(
  client: SupabaseClient,
  delivery: ClaimedEmailDelivery,
): Promise<{ delivery: PreparedEmailDelivery | null; outcome: EmailSendOutcome }> {
  const { data, error } = await client.rpc("prepare_email_delivery", {
    p_delivery_id: delivery.out_delivery_id,
    p_lease_token: delivery.out_lease_token,
  });
  if (error) {
    return { delivery: null, outcome: { outcome: "transient", httpStatus: null } };
  }
  if (!Array.isArray(data) || data.length !== 1 || !isPreparedEmail(data[0])) {
    return { delivery: null, outcome: { outcome: "permanent", httpStatus: 400 } };
  }
  return { delivery: { ...delivery, ...data[0] }, outcome: { outcome: "success", httpStatus: 200 } };
}

export async function runImportantEmailDelivery(config: ImportantEmailConfig) {
  const client = createEmailDatabaseClient(config);
  const counts = {
    claimed: 0,
    acknowledged: 0,
    failedAcknowledgements: 0,
    finalizationFailures: 0,
    sendFailures: 0,
  };
  let runId: string | null = null;
  let runToken: string | null = null;
  try {
    const { data, error } = await client.rpc("claim_email_deliveries", { p_limit: EMAIL_CLAIM_LIMIT });
    if (error || !Array.isArray(data)) return counts;
    const deliveries = data.filter(isClaimedEmail);
    counts.claimed = deliveries.length;
    if (!deliveries.length) return counts;
    runId = deliveries[0].out_run_id;
    runToken = deliveries[0].out_run_token;
    for (let offset = 0; offset < deliveries.length; offset += EMAIL_CONCURRENCY) {
      const wave = deliveries.slice(offset, offset + EMAIL_CONCURRENCY);
      const outcomes = await Promise.all(wave.map(async (delivery) => {
        try {
          const prepared = await prepareDelivery(client, delivery);
          if (!prepared.delivery) return prepared.outcome;
          if (Date.parse(prepared.delivery.out_send_guard_expires_at) <= Date.now() + RESEND_TIMEOUT_MS) {
            return { outcome: "transient", httpStatus: null } as EmailSendOutcome;
          }
          return await sendResendEmail(config.apiKey, buildImportantEmail(config, prepared.delivery));
        } catch {
          return { outcome: "permanent", httpStatus: 400 } as EmailSendOutcome;
        }
      }));
      counts.sendFailures += outcomes.filter((result) => result.outcome !== "success").length;
      const acknowledgements = await Promise.all(
        wave.map((delivery, index) => acknowledge(client, delivery, outcomes[index])),
      );
      counts.acknowledged += acknowledgements.filter(Boolean).length;
      counts.failedAcknowledgements += acknowledgements.filter((value) => !value).length;
    }
    return counts;
  } finally {
    if (runId && runToken) {
      const { data, error } = await client.rpc("finish_email_delivery_run", {
        p_run_id: runId,
        p_run_token: runToken,
      });
      if (error || data !== true) counts.finalizationFailures += 1;
    }
    console.info("Important email delivery finished.", counts);
  }
}

import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import webpush from "web-push"

export const PUSH_CLAIM_LIMIT = 20
export const PUSH_CONCURRENCY = 10
export const PUSH_DATABASE_REQUEST_TIMEOUT_MS = 1_000
export const PUSH_REQUEST_TIMEOUT_MS = 8_000
export const PUSH_RUN_BUDGET_MS = 45_000
export const PUSH_CLAIM_START_MINIMUM_MS = 11_000
export const PUSH_WAVE_START_MINIMUM_MS = 9_000
export const PUSH_TTL_SECONDS = 3_600
export const PUSH_URGENCY = "normal" as const

// Each database RPC aborts after 1 second. One wave can spend 8 seconds in Web
// Push, and its concurrent acknowledgements fit the remaining second:
// 8,000 + 1,000 = 9,000 ms. A 20-row claim is at most two waves (2 x 8,000 =
// 16,000 ms of send time), safely inside the 45,000 ms run budget. A new claim
// needs 11,000 ms: the 9,000 ms wave reserve plus a 2,000 ms margin for the
// separately bounded claim and finish calls, so a claim is not taken when its
// first wave cannot safely start. We still re-check the 9,000 ms minimum before
// every wave; rows leased but not started are left untouched for the database's
// two-minute lease expiry.

type PushSenderConfig = {
  anonKey: string
  capability: string
  publicKey: string
  supabaseUrl: string
  vapidSubject: string
}

export type ClaimedPushDelivery = {
  out_attempt: number
  out_auth_secret: string
  out_body: string
  out_delivery_id: string
  out_endpoint: string
  out_lease_expires_at: string
  out_lease_token: string
  out_notification_type: string
  out_p256dh: string
  out_run_id: string
  out_run_token: string
  out_target_path: string
  out_title: string
}

export type PushOutcome = {
  httpStatus: number | null
  outcome: "gone" | "permanent" | "success" | "transient"
}

type SendNotification = typeof webpush.sendNotification

function requiredEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error("Push sender configuration is unavailable.")
  return value
}

export function preparePushSender(): PushSenderConfig {
  const config = {
    anonKey: requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    capability: requiredEnv("PUSH_DB_CAPABILITY"),
    publicKey: requiredEnv("NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY"),
    supabaseUrl: requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    vapidSubject: requiredEnv("PUSH_VAPID_SUBJECT"),
  }
  const privateKey = requiredEnv("PUSH_VAPID_PRIVATE_KEY")

  // web-push validates the subject and matching key shapes here. This happens
  // before claim_push_deliveries, so bad VAPID configuration leaves every
  // queued delivery pending.
  webpush.setVapidDetails(
    config.vapidSubject,
    config.publicKey,
    privateKey,
  )
  return config
}

export function isAllowedPushEndpoint(rawEndpoint: string) {
  try {
    const authority = rawEndpoint.match(/^https:\/\/([^/?#]+)/i)?.[1]
    if (!authority || authority.includes(":") || authority.includes("@")) return false
    const endpoint = new URL(rawEndpoint)
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      endpoint.hash
    ) {
      return false
    }
    const host = endpoint.hostname.toLowerCase()
    return (
      host === "fcm.googleapis.com" ||
      host === "updates.push.services.mozilla.com" ||
      host === "web.push.apple.com" ||
      /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+notify\.windows\.com$/.test(host)
    )
  } catch {
    return false
  }
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes("=")) return null
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=")
    const bytes = Buffer.from(padded, "base64")
    const canonical = bytes.toString("base64url")
    return canonical === value ? bytes : null
  } catch {
    return null
  }
}

export function hasValidPushKeys(p256dh: string, auth: string) {
  return decodeBase64Url(p256dh)?.length === 65 && decodeBase64Url(auth)?.length === 16
}

const PUSH_UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
const PUSH_TARGET_PATTERN = new RegExp(
  `^/tasks/${PUSH_UUID}(?:#comment-${PUSH_UUID})?$`,
  "i",
)

export function validatedPushTargetPath(value: string) {
  return value === "/" || PUSH_TARGET_PATTERN.test(value) ? value : "/"
}

export function buildPushPayload(delivery: ClaimedPushDelivery) {
  return JSON.stringify({
    title: delivery.out_title,
    body: delivery.out_body,
    tag: delivery.out_delivery_id,
    targetPath: validatedPushTargetPath(delivery.out_target_path),
  })
}

export function classifyHttpStatus(statusCode: number): PushOutcome {
  if (statusCode >= 200 && statusCode <= 299) {
    return { outcome: "success", httpStatus: statusCode }
  }
  if (statusCode === 404 || statusCode === 410) {
    return { outcome: "gone", httpStatus: statusCode }
  }
  if (
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    (statusCode >= 500 && statusCode <= 599)
  ) {
    return { outcome: "transient", httpStatus: statusCode }
  }
  if (statusCode >= 400 && statusCode <= 499) {
    return { outcome: "permanent", httpStatus: statusCode }
  }
  // Web Push endpoints must not redirect. The database accepts permanent only
  // with a 4xx status, so an unexpected 3xx/protocol status is represented as
  // a permanent sender-side validation failure.
  return { outcome: "permanent", httpStatus: 400 }
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return null
  const status = (error as { statusCode?: unknown }).statusCode
  return typeof status === "number" && Number.isInteger(status) ? status : null
}

export async function sendClaimedDelivery(
  delivery: ClaimedPushDelivery,
  sendNotification: SendNotification = webpush.sendNotification.bind(webpush),
): Promise<PushOutcome> {
  if (
    !isAllowedPushEndpoint(delivery.out_endpoint) ||
    !hasValidPushKeys(delivery.out_p256dh, delivery.out_auth_secret)
  ) {
    return { outcome: "permanent", httpStatus: 400 }
  }

  let deadlineTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      deadlineTimer = setTimeout(() => {
        reject(Object.assign(new Error("Web Push deadline exceeded."), { code: "ETIMEDOUT" }))
      }, PUSH_REQUEST_TIMEOUT_MS)
    })
    const response = await Promise.race([
      sendNotification(
        {
          endpoint: delivery.out_endpoint,
          keys: {
            auth: delivery.out_auth_secret,
            p256dh: delivery.out_p256dh,
          },
        },
        buildPushPayload(delivery),
        {
          TTL: PUSH_TTL_SECONDS,
          timeout: PUSH_REQUEST_TIMEOUT_MS,
          urgency: PUSH_URGENCY,
        },
      ),
      deadline,
    ])
    return classifyHttpStatus(response.statusCode)
  } catch (error) {
    const status = errorStatus(error)
    if (status !== null) return classifyHttpStatus(status)

    // Only stored endpoint/key validation is terminal before send. Genuine
    // network failures, timeouts, and every other unexpected library failure
    // are bounded by the database retry schedule instead of being dropped.
    return { outcome: "transient", httpStatus: null }
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
  }
}

function isClaimedDelivery(value: unknown): value is ClaimedPushDelivery {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  const strings = [
    "out_auth_secret", "out_body", "out_delivery_id", "out_endpoint",
    "out_lease_expires_at", "out_lease_token", "out_notification_type",
    "out_p256dh", "out_run_id", "out_run_token", "out_target_path", "out_title",
  ]
  return strings.every((key) => typeof row[key] === "string") &&
    typeof row.out_attempt === "number"
}

async function fetchPushDatabase(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const controller = new AbortController()
  const upstreamSignal = init?.signal
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal?.aborted) controller.abort(upstreamSignal.reason)
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true })
  const timeout = setTimeout(
    () => controller.abort(),
    PUSH_DATABASE_REQUEST_TIMEOUT_MS,
  )

  try {
    const response = await globalThis.fetch(input, { ...init, signal: controller.signal })
    // Supabase reads the body after fetch resolves with headers. Buffer the
    // small RPC response here so a stalled body remains inside this deadline.
    const body = await response.arrayBuffer()
    return new Response(body.byteLength === 0 ? null : body, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    })
  } finally {
    clearTimeout(timeout)
    upstreamSignal?.removeEventListener("abort", abortFromUpstream)
  }
}

function createPushDatabaseClient(config: PushSenderConfig) {
  return createClient(config.supabaseUrl, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      fetch: fetchPushDatabase,
      headers: { "x-ceit-push-capability": config.capability },
    },
  })
}

async function acknowledge(
  client: SupabaseClient,
  delivery: ClaimedPushDelivery,
  result: PushOutcome,
) {
  const { data, error } = await client.rpc("acknowledge_push_delivery", {
    p_delivery_id: delivery.out_delivery_id,
    p_http_status: result.httpStatus,
    p_lease_token: delivery.out_lease_token,
    p_outcome: result.outcome,
  })
  return !error && data === true
}

type RunCounts = {
  acknowledged: number
  claimFailures: number
  claimed: number
  failedAcknowledgements: number
  finishedRuns: number
  unsent: number
}

export async function runPushDeliveryLoop(config: PushSenderConfig) {
  const client = createPushDatabaseClient(config)
  const startedAt = Date.now()
  const counts: RunCounts = {
    acknowledged: 0,
    claimFailures: 0,
    claimed: 0,
    failedAcknowledgements: 0,
    finishedRuns: 0,
    unsent: 0,
  }

  try {
    while (PUSH_RUN_BUDGET_MS - (Date.now() - startedAt) >= PUSH_CLAIM_START_MINIMUM_MS) {
      const { data, error } = await client.rpc("claim_push_deliveries", {
        p_limit: PUSH_CLAIM_LIMIT,
      })
      if (error) {
        counts.claimFailures += 1
        break
      }
      if (!Array.isArray(data) || data.length === 0) break

      const deliveries = data.filter(isClaimedDelivery)
      counts.claimed += deliveries.length
      if (deliveries.length === 0) break
      const { out_run_id: runId, out_run_token: runToken } = deliveries[0]

      let sent = 0
      for (let offset = 0; offset < deliveries.length; offset += PUSH_CONCURRENCY) {
        const remaining = PUSH_RUN_BUDGET_MS - (Date.now() - startedAt)
        if (remaining < PUSH_WAVE_START_MINIMUM_MS) break

        const wave = deliveries.slice(offset, offset + PUSH_CONCURRENCY)
        const outcomes = await Promise.all(wave.map((row) => sendClaimedDelivery(row)))
        const acknowledgements = await Promise.all(
          wave.map((row, index) => acknowledge(client, row, outcomes[index])),
        )
        sent += wave.length
        for (const acknowledged of acknowledgements) {
          if (acknowledged) counts.acknowledged += 1
          else counts.failedAcknowledgements += 1
        }
      }
      counts.unsent += deliveries.length - sent

      const { data: finished, error: finishError } = await client.rpc(
        "finish_push_delivery_run",
        { p_run_id: runId, p_run_token: runToken },
      )
      if (!finishError && finished === true) counts.finishedRuns += 1

      if (sent < deliveries.length) break
    }
  } finally {
    console.info("Push wake finished.", counts)
  }
}

import { Buffer } from "node:buffer"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import webpush from "web-push"

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock("server-only", () => ({}))
vi.mock("@supabase/supabase-js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@supabase/supabase-js")>()),
  createClient: mocks.createClient,
}))

import {
  buildPushPayload,
  classifyHttpStatus,
  hasValidPushKeys,
  isAllowedPushEndpoint,
  PUSH_CLAIM_START_MINIMUM_MS,
  PUSH_CLAIM_LIMIT,
  PUSH_CONCURRENCY,
  PUSH_DATABASE_REQUEST_TIMEOUT_MS,
  PUSH_REQUEST_TIMEOUT_MS,
  PUSH_RUN_BUDGET_MS,
  PUSH_TTL_SECONDS,
  PUSH_URGENCY,
  PUSH_WAVE_START_MINIMUM_MS,
  preparePushSender,
  runPushDeliveryLoop,
  sendClaimedDelivery,
  type ClaimedPushDelivery,
} from "@/lib/push/push-sender"

const validP256dh = Buffer.alloc(65, 1).toString("base64url")
const validAuth = Buffer.alloc(16, 2).toString("base64url")

function delivery(change: Partial<ClaimedPushDelivery> = {}): ClaimedPushDelivery {
  return {
    out_attempt: 1,
    out_auth_secret: validAuth,
    out_body: "You were mentioned in a task.",
    out_delivery_id: "10000000-0000-4000-8000-000000000001",
    out_endpoint: "https://fcm.googleapis.com/push/example",
    out_lease_expires_at: "2026-11-10T12:02:00Z",
    out_lease_token: "20000000-0000-4000-8000-000000000001",
    out_notification_type: "mention",
    out_p256dh: validP256dh,
    out_run_id: "30000000-0000-4000-8000-000000000001",
    out_run_token: "40000000-0000-4000-8000-000000000001",
    out_target_path: "/notifications",
    out_title: "CEIT Connect",
    ...change,
  }
}

beforeEach(() => {
  mocks.createClient.mockReset()
  vi.spyOn(console, "info").mockImplementation(() => undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("push sender constants and payload", () => {
  it("validates all VAPID values before a run can claim", async () => {
    const webpush = (await import("web-push")).default
    const keys = webpush.generateVAPIDKeys()
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co"
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon"
    process.env.PUSH_DB_CAPABILITY = "capability"
    process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY = keys.publicKey
    process.env.PUSH_VAPID_PRIVATE_KEY = keys.privateKey
    process.env.PUSH_VAPID_SUBJECT = "mailto:push@example.com"

    expect(preparePushSender()).toMatchObject({
      publicKey: keys.publicKey,
      vapidSubject: "mailto:push@example.com",
    })
    delete process.env.PUSH_VAPID_PRIVATE_KEY
    expect(() => preparePushSender()).toThrow("Push sender configuration is unavailable.")
  })

  it("pins the approved batch and time arithmetic", () => {
    expect(PUSH_CLAIM_LIMIT).toBe(20)
    expect(PUSH_CONCURRENCY).toBe(10)
    expect(PUSH_DATABASE_REQUEST_TIMEOUT_MS).toBe(1_000)
    expect(PUSH_REQUEST_TIMEOUT_MS).toBe(8_000)
    expect(PUSH_RUN_BUDGET_MS).toBe(45_000)
    expect(PUSH_CLAIM_START_MINIMUM_MS).toBe(11_000)
    expect(PUSH_WAVE_START_MINIMUM_MS).toBe(9_000)
  })

  it("uses the delivery id as tag and adds no other payload field", () => {
    expect(JSON.parse(buildPushPayload(delivery()))).toEqual({
      title: "CEIT Connect",
      body: "You were mentioned in a task.",
      tag: "10000000-0000-4000-8000-000000000001",
    })
  })

  it("pins TTL and urgency on the transport", async () => {
    const send = vi.fn().mockResolvedValue({ statusCode: 201 })
    await expect(sendClaimedDelivery(delivery(), send)).resolves.toEqual({
      outcome: "success",
      httpStatus: 201,
    })
    expect(send).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({
        TTL: PUSH_TTL_SECONDS,
        timeout: PUSH_REQUEST_TIMEOUT_MS,
        urgency: PUSH_URGENCY,
      }),
    )
    expect(PUSH_TTL_SECONDS).toBe(3_600)
    expect(PUSH_URGENCY).toBe("normal")
  })
})

describe("push endpoint and key validation", () => {
  it.each([
    "https://fcm.googleapis.com/push/a",
    "https://updates.push.services.mozilla.com/wpush/v2/a",
    "https://web.push.apple.com/Q123",
    "https://wns2-am3p.notify.windows.com/w/?token=a",
  ])("accepts %s", (endpoint) => expect(isAllowedPushEndpoint(endpoint)).toBe(true))

  it.each([
    "http://fcm.googleapis.com/push/a",
    "https://user@fcm.googleapis.com/push/a",
    "https://fcm.googleapis.com:443/push/a",
    "https://fcm.googleapis.com/push/a#fragment",
    "https://notify.windows.com/w/a",
    "https://evilnotify.windows.com/w/a",
    "https://fcm.googleapis.com.evil.example/push/a",
  ])("rejects %s", (endpoint) => expect(isAllowedPushEndpoint(endpoint)).toBe(false))

  it("requires exactly 65-byte p256dh and 16-byte auth values", () => {
    expect(hasValidPushKeys(validP256dh, validAuth)).toBe(true)
    expect(hasValidPushKeys(Buffer.alloc(64).toString("base64url"), validAuth)).toBe(false)
    expect(hasValidPushKeys(validP256dh, Buffer.alloc(15).toString("base64url"))).toBe(false)
  })

  it("marks bad stored keys permanent without attempting a request", async () => {
    const send = vi.fn()
    await expect(sendClaimedDelivery(delivery({ out_p256dh: "bad" }), send)).resolves.toEqual({
      outcome: "permanent",
      httpStatus: 400,
    })
    expect(send).not.toHaveBeenCalled()
  })
})

describe("push outcome mapping", () => {
  it.each([
    [200, "success", 200],
    [299, "success", 299],
    [404, "gone", 404],
    [410, "gone", 410],
    [408, "transient", 408],
    [425, "transient", 425],
    [429, "transient", 429],
    [500, "transient", 500],
    [599, "transient", 599],
    [400, "permanent", 400],
    [403, "permanent", 403],
    [422, "permanent", 422],
    [302, "permanent", 400],
  ] as const)("maps HTTP %i", (status, outcome, httpStatus) => {
    expect(classifyHttpStatus(status)).toEqual({ outcome, httpStatus })
  })

  it("retries a simulated network error", async () => {
    const networkError = Object.assign(new Error("socket failed"), { code: "ECONNRESET" })
    const send = vi.fn().mockRejectedValue(networkError)
    await expect(sendClaimedDelivery(delivery(), send)).resolves.toEqual({
      outcome: "transient",
      httpStatus: null,
    })
  })

  it("retries an unexpected library error", async () => {
    const send = vi.fn().mockRejectedValue(new Error("unexpected"))
    await expect(sendClaimedDelivery(delivery(), send)).resolves.toEqual({
      outcome: "transient",
      httpStatus: null,
    })
  })
})

describe("push delivery loop budget and run bookkeeping", () => {
  const config = {
    anonKey: "anon",
    capability: "capability",
    publicKey: "public-key",
    supabaseUrl: "https://example.supabase.co",
    vapidSubject: "mailto:push@example.com",
  }

  it("aborts each push database request at the one-second RPC timeout", async () => {
    vi.useFakeTimers()
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    mocks.createClient.mockReturnValue({ rpc })

    await runPushDeliveryLoop(config)

    const options = mocks.createClient.mock.calls[0]?.[2] as {
      global: { fetch: typeof fetch; headers: Record<string, string> }
    }
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        requestSignal = init?.signal ?? undefined
        requestSignal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
        }, { once: true })
      })
    )))

    const pendingRequest = options.global.fetch("https://example.supabase.co/rest/v1/rpc/claim")
    const rejected = expect(pendingRequest).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(PUSH_DATABASE_REQUEST_TIMEOUT_MS)

    await rejected
    expect(requestSignal?.aborted).toBe(true)
    expect(options.global.headers).toEqual({
      "x-ceit-push-capability": config.capability,
    })
  })

  it("keeps the RPC timeout active when headers arrive but the body stalls", async () => {
    vi.useFakeTimers()
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    mocks.createClient.mockReturnValue({ rpc })

    await runPushDeliveryLoop(config)

    const options = mocks.createClient.mock.calls[0]?.[2] as {
      global: { fetch: typeof fetch }
    }
    let requestSignal: AbortSignal | undefined
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          requestSignal?.addEventListener("abort", () => {
            controller.error(Object.assign(new Error("aborted"), { name: "AbortError" }))
          }, { once: true })
        },
      })
      return new Response(body, {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    }))

    const pendingRequest = options.global.fetch("https://example.supabase.co/rest/v1/rpc/claim")
    const rejected = expect(pendingRequest).rejects.toMatchObject({ name: "AbortError" })
    await vi.advanceTimersByTimeAsync(PUSH_DATABASE_REQUEST_TIMEOUT_MS)

    await rejected
    expect(requestSignal?.aborted).toBe(true)
  })

  it("does not claim when less than the claim-start minimum remains", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const rpc = vi.fn()
    mocks.createClient.mockReturnValue({ rpc })
    vi.spyOn(Date, "now")
      .mockReturnValueOnce(0)
      .mockReturnValue(PUSH_RUN_BUDGET_MS - PUSH_CLAIM_START_MINIMUM_MS + 1)

    await runPushDeliveryLoop(config)

    expect(rpc).not.toHaveBeenCalled()
    expect(console.info).toHaveBeenLastCalledWith("Push wake finished.", expect.objectContaining({
      claimed: 0,
      unsent: 0,
    }))
  })

  it("leaves a claimed row unsent and stops when a wave has too little time", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const row = delivery()
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      if (name === "claim_push_deliveries") {
        vi.setSystemTime(PUSH_RUN_BUDGET_MS - PUSH_WAVE_START_MINIMUM_MS + 1)
        return { data: [row], error: null }
      }
      if (name === "finish_push_delivery_run") return { data: true, error: null }
      throw new Error(`Unexpected RPC ${name}`)
    })
    mocks.createClient.mockReturnValue({ rpc })
    const send = vi.spyOn(webpush, "sendNotification")

    await runPushDeliveryLoop(config)

    expect(send).not.toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith("finish_push_delivery_run", {
      p_run_id: row.out_run_id,
      p_run_token: row.out_run_token,
    })
    expect(console.info).toHaveBeenLastCalledWith("Push wake finished.", expect.objectContaining({
      claimed: 1,
      unsent: 1,
    }))
  })

  it("finishes with the run id and token from the first claimed row", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const first = delivery()
    const second = delivery({
      out_delivery_id: "10000000-0000-4000-8000-000000000002",
      out_run_id: "30000000-0000-4000-8000-000000000002",
      out_run_token: "40000000-0000-4000-8000-000000000002",
    })
    let claimed = false
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      if (name === "claim_push_deliveries") {
        if (claimed) return { data: [], error: null }
        claimed = true
        return { data: [first, second], error: null }
      }
      if (name === "acknowledge_push_delivery") return { data: true, error: null }
      if (name === "finish_push_delivery_run") return { data: true, error: null }
      throw new Error(`Unexpected RPC ${name}`)
    })
    mocks.createClient.mockReturnValue({ rpc })
    vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201 } as never)

    await runPushDeliveryLoop(config)

    expect(rpc).toHaveBeenCalledWith("finish_push_delivery_run", {
      p_run_id: first.out_run_id,
      p_run_token: first.out_run_token,
    })
  })

  it("counts a failed acknowledgement without aborting the run", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const row = delivery()
    let claimed = false
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      if (name === "claim_push_deliveries") {
        if (claimed) return { data: [], error: null }
        claimed = true
        return { data: [row], error: null }
      }
      if (name === "acknowledge_push_delivery") {
        return { data: null, error: { message: "temporary database error" } }
      }
      if (name === "finish_push_delivery_run") return { data: true, error: null }
      throw new Error(`Unexpected RPC ${name}`)
    })
    mocks.createClient.mockReturnValue({ rpc })
    vi.spyOn(webpush, "sendNotification").mockResolvedValue({ statusCode: 201 } as never)

    await runPushDeliveryLoop(config)

    expect(rpc).toHaveBeenCalledWith("finish_push_delivery_run", {
      p_run_id: row.out_run_id,
      p_run_token: row.out_run_token,
    })
    expect(console.info).toHaveBeenLastCalledWith("Push wake finished.", expect.objectContaining({
      acknowledged: 0,
      failedAcknowledgements: 1,
      finishedRuns: 1,
    }))
  })
})

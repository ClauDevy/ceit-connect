import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  preparePushSender: vi.fn(),
  runPushDeliveryLoop: vi.fn(),
}))

vi.mock("next/server", () => ({ after: mocks.after }))
vi.mock("@/lib/push/push-sender", () => ({
  preparePushSender: mocks.preparePushSender,
  runPushDeliveryLoop: mocks.runPushDeliveryLoop,
}))

import { POST } from "./route"

function request(secret?: string, body = "ignored") {
  return new Request("http://localhost/api/push/wake", {
    method: "POST",
    headers: secret ? { "x-ceit-wake-secret": secret } : undefined,
    body,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.PUSH_WAKE_SECRET = "correct-secret"
  mocks.preparePushSender.mockReturnValue({ ready: true })
  mocks.after.mockImplementation(() => undefined)
  vi.spyOn(console, "error").mockImplementation(() => undefined)
})

describe("POST /api/push/wake", () => {
  it.each([undefined, "wrong-secret"])("rejects a missing or wrong secret before VAPID or claim", async (secret) => {
    const response = await POST(request(secret))
    expect(response.status).toBe(401)
    expect(mocks.preparePushSender).not.toHaveBeenCalled()
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.runPushDeliveryLoop).not.toHaveBeenCalled()
  })

  it("validates VAPID before scheduling and claims nothing when it is invalid", async () => {
    mocks.preparePushSender.mockImplementation(() => { throw new Error("invalid VAPID") })
    const response = await POST(request("correct-secret"))
    expect(response.status).toBe(500)
    expect(mocks.after).not.toHaveBeenCalled()
    expect(mocks.runPushDeliveryLoop).not.toHaveBeenCalled()
  })

  it("answers before the scheduled work runs and ignores the body", async () => {
    let scheduled: (() => unknown) | undefined
    mocks.after.mockImplementation((callback) => { scheduled = callback })
    const response = await POST(request("correct-secret", "not-json-and-ignored"))

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({ accepted: true })
    expect(mocks.runPushDeliveryLoop).not.toHaveBeenCalled()
    expect(scheduled).toBeTypeOf("function")

    await scheduled?.()
    expect(mocks.runPushDeliveryLoop).toHaveBeenCalledWith({ ready: true })
  })
})

import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  base64UrlToBytes,
  bytesToBase64Url,
  detectPushPlatform,
  pushDeviceLabel,
  pushDeviceStorageKey,
} from "@/lib/push/push-browser"

beforeEach(() => {
  vi.stubGlobal("window", {
    atob,
    btoa,
  })
})

describe("push browser helpers", () => {
  it("round-trips unpadded base64url", () => {
    const bytes = Uint8Array.from([251, 255, 0, 1]).buffer
    const encoded = bytesToBase64Url(bytes)
    expect(encoded).toBe("-_8AAQ")
    expect(encoded).not.toContain("=")
    expect(Array.from(base64UrlToBytes(encoded))).toEqual([251, 255, 0, 1])
  })

  it.each([
    ["Mozilla/5.0 (iPhone)", 0, "ios"],
    ["Mozilla/5.0 (Macintosh)", 5, "ios"],
    ["Mozilla/5.0 (Linux; Android 15)", 5, "android"],
    ["Mozilla/5.0 (Windows NT 10.0)", 0, "desktop"],
    ["custom-agent", 0, "unknown"],
  ] as const)("classifies %s", (agent, touches, platform) => {
    expect(detectPushPlatform(agent, touches)).toBe(platform)
  })

  it("uses short non-identifying labels and user-specific storage", () => {
    expect(pushDeviceLabel("ios")).toBe("iPhone or iPad app")
    expect(pushDeviceLabel("android")).toBe("Android browser")
    expect(pushDeviceLabel("desktop")).toBe("Desktop browser")
    expect(pushDeviceStorageKey("user-a")).not.toBe(pushDeviceStorageKey("user-b"))
  })
})

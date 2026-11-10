// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { bestEffortPushSignOut } from "@/lib/push/push-sign-out"
import { pushDeviceStorageKey } from "@/lib/push/push-browser"

beforeEach(() => window.localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe("push-aware sign-out", () => {
  it("removes only the stored current device, unsubscribes, and clears storage", async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const unsubscribe = vi.fn().mockResolvedValue(true)
    window.localStorage.setItem(pushDeviceStorageKey("user-a"), "device-a")
    window.localStorage.setItem(pushDeviceStorageKey("user-b"), "device-b")

    await bestEffortPushSignOut("user-a", 100, {
      getBrowserSubscription: async () => ({ unsubscribe } as unknown as PushSubscription),
      removeDatabaseSubscription: remove,
    })

    expect(remove).toHaveBeenCalledWith("device-a")
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(pushDeviceStorageKey("user-a"))).toBeNull()
    expect(window.localStorage.getItem(pushDeviceStorageKey("user-b"))).toBe("device-b")
  })

  it("settles at its timeout and clears storage when cleanup never returns", async () => {
    window.localStorage.setItem(pushDeviceStorageKey("user-a"), "device-a")
    const never = new Promise<void>(() => undefined)
    const clearTimeout = vi.spyOn(window, "clearTimeout")
    await bestEffortPushSignOut("user-a", 1, {
      getBrowserSubscription: async () => null,
      removeDatabaseSubscription: async () => never,
    })
    expect(clearTimeout).toHaveBeenCalledOnce()
    expect(window.localStorage.getItem(pushDeviceStorageKey("user-a"))).toBeNull()
  })

  it("swallows localStorage access failures so sign-out can continue", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage blocked")
    })
    const unsubscribe = vi.fn().mockResolvedValue(true)

    await expect(bestEffortPushSignOut("user-a", 100, {
      getBrowserSubscription: async () => ({ unsubscribe } as unknown as PushSubscription),
      removeDatabaseSubscription: vi.fn(),
    })).resolves.toBeUndefined()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

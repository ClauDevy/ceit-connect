// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))
vi.mock("@/lib/supabase/client", () => ({ createClient: mocks.createClient }))

import { PushNotificationsControl } from "@/components/settings/push-notifications-control"
import { pushDeviceStorageKey } from "@/lib/push/push-browser"

function setNavigator(agent: string, subscription: PushSubscription | null) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: agent })
  Object.defineProperty(window.navigator, "maxTouchPoints", { configurable: true, value: 0 })
  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: {
      getRegistration: vi.fn().mockResolvedValue({
        pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) },
      }),
    },
  })
}

beforeEach(() => {
  window.localStorage.clear()
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  })
  Object.defineProperty(window, "PushManager", { configurable: true, value: function PushManager() {} })
  vi.stubGlobal("Notification", {
    permission: "default",
    requestPermission: vi.fn().mockResolvedValue("granted"),
  })
  mocks.createClient.mockReset()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("Notifications on this device", () => {
  it("shows only the Home Screen hint on an uninstalled iPhone", async () => {
    setNavigator("Mozilla/5.0 (iPhone)", null)
    render(<PushNotificationsControl userId="user-a" />)

    expect(await screen.findByText(/add CEIT Connect to your Home Screen/i)).toBeTruthy()
    expect(screen.queryByRole("button", { name: /enable notifications/i })).toBeNull()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it("removes the listed stored id before unsubscribing the browser", async () => {
    const order: string[] = []
    const unsubscribe = vi.fn().mockImplementation(async () => {
      order.push("browser")
      return true
    })
    const browserSubscription = { unsubscribe } as unknown as PushSubscription
    setNavigator("Mozilla/5.0 (Windows NT 10.0)", browserSubscription)
    window.localStorage.setItem(pushDeviceStorageKey("user-a"), "device-a")
    const rpc = vi.fn().mockImplementation(async (name: string) => {
      if (name === "list_my_push_subscriptions") {
        return {
          data: [{
            out_id: "device-a",
            out_device_label: "Desktop browser",
            out_platform: "desktop",
            out_expires_at: null,
            out_created_at: "2026-11-10T12:00:00Z",
            out_last_seen_at: "2026-11-10T12:00:00Z",
          }],
          error: null,
        }
      }
      order.push("database")
      return { data: true, error: null }
    })
    mocks.createClient.mockReturnValue({ rpc })

    render(<PushNotificationsControl userId="user-a" />)
    fireEvent.click(await screen.findByRole("button", { name: /turn off on this device/i }))

    await waitFor(() => expect(order).toEqual(["database", "browser"]))
    expect(rpc).toHaveBeenCalledWith("remove_my_push_subscription", {
      p_subscription_id: "device-a",
    })
    expect(window.localStorage.getItem(pushDeviceStorageKey("user-a"))).toBeNull()
  })

  it("waits for an active worker before reading or creating the subscription", async () => {
    setNavigator("Mozilla/5.0 (Windows NT 10.0)", null)
    process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY = "AQID"
    const order: string[] = []
    let resolveReady: ((registration: ServiceWorkerRegistration) => void) | undefined
    const ready = new Promise<ServiceWorkerRegistration>((resolve) => { resolveReady = resolve })
    const subscribe = vi.fn()
    const getSubscription = vi.fn().mockImplementation(async () => {
      order.push("ready-push-manager")
      return null
    })
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistration: vi.fn().mockResolvedValue(null),
        register: vi.fn().mockImplementation(async () => {
          order.push("register")
          return { pushManager: { getSubscription: vi.fn(), subscribe: vi.fn() } }
        }),
        ready,
      },
    })
    mocks.createClient.mockReturnValue({
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    })

    render(<PushNotificationsControl userId="user-a" />)
    fireEvent.click(await screen.findByRole("button", { name: /enable notifications/i }))
    await waitFor(() => expect(order).toEqual(["register"]))
    expect(getSubscription).not.toHaveBeenCalled()

    resolveReady?.({ pushManager: { getSubscription, subscribe } } as unknown as ServiceWorkerRegistration)
    await waitFor(() => expect(getSubscription).toHaveBeenCalledOnce())
    expect(order).toEqual(["register", "ready-push-manager"])
  })
})

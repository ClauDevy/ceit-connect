"use client"

import { useEffect, useState } from "react"
import { CheckCircle2, Smartphone, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/inline-alert"
import { createClient } from "@/lib/supabase/client"
import {
  base64UrlToBytes,
  bytesToBase64Url,
  detectPushPlatform,
  isInstalledApp,
  pushDeviceLabel,
  pushDeviceStorageKey,
  type PushPlatform,
} from "@/lib/push/push-browser"

type DeviceRow = {
  out_created_at: string
  out_device_label: string
  out_expires_at: string | null
  out_id: string
  out_last_seen_at: string
  out_platform: PushPlatform
}

type ViewState =
  | "blocked"
  | "checking"
  | "error"
  | "limit"
  | "needs-install"
  | "off"
  | "on"
  | "on-error"
  | "unavailable"
  | "unsupported"
  | "working"

function isDeviceRow(value: unknown): value is DeviceRow {
  if (!value || typeof value !== "object") return false
  const row = value as Record<string, unknown>
  return typeof row.out_id === "string" &&
    typeof row.out_device_label === "string" &&
    typeof row.out_platform === "string" &&
    typeof row.out_created_at === "string" &&
    typeof row.out_last_seen_at === "string" &&
    (row.out_expires_at === null || typeof row.out_expires_at === "string")
}

function supportsPush() {
  return "Notification" in window && "serviceWorker" in navigator && "PushManager" in window
}

function inspectPushCapability() {
  if (!supportsPush()) {
    return { platform: "unknown" as const, state: "unsupported" as const }
  }
  const platform = detectPushPlatform(navigator.userAgent, navigator.maxTouchPoints)
  if (platform === "ios" && !isInstalledApp()) {
    return { platform, state: "needs-install" as const }
  }
  if (Notification.permission === "denied") {
    return { platform, state: "blocked" as const }
  }
  return { platform, state: null }
}

async function currentBrowserSubscription() {
  const registration = await navigator.serviceWorker.getRegistration("/sw.js")
  return registration?.pushManager.getSubscription() ?? null
}

export function PushNotificationsControl({ userId }: { userId: string }) {
  const [state, setState] = useState<ViewState>("checking")
  const [message, setMessage] = useState("")
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [platform, setPlatform] = useState<PushPlatform>("unknown")
  const storageKey = pushDeviceStorageKey(userId)

  useEffect(() => {
    let active = true
    const capability = inspectPushCapability()

    async function loadState() {
      // Keep every state update behind an async boundary. The synchronous
      // capability inspection above performs no registration or mutation.
      await Promise.resolve()
      if (!active) return
      setPlatform(capability.platform)
      if (capability.state) {
        setState(capability.state)
        return
      }

      try {
        const supabase = createClient()
        const { data, error } = await supabase.rpc("list_my_push_subscriptions")
        if (!active) return
        if (error || !Array.isArray(data) || !data.every(isDeviceRow)) {
          setState("unavailable")
          return
        }
        const storedId = window.localStorage.getItem(storageKey)
        const browserSubscription = await currentBrowserSubscription()
        if (!active) return
        setDevices(data)
        setState(
          browserSubscription && storedId && data.some((row) => row.out_id === storedId)
            ? "on"
            : "off",
        )
      } catch {
        if (active) setState("unavailable")
      }
    }

    void loadState()
    return () => { active = false }
  }, [storageKey])

  async function enable() {
    const permissionPromise = Notification.requestPermission()
    setState("working")
    setMessage("")
    try {
      const permission = await permissionPromise
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off")
        return
      }
      const publicKey = process.env.NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY
      if (!publicKey) throw new Error("Notifications are not configured.")

      await navigator.serviceWorker.register("/sw.js", { scope: "/" })
      const readyRegistration = await navigator.serviceWorker.ready
      const priorSubscription = await readyRegistration.pushManager.getSubscription()
      const subscription = priorSubscription ?? await readyRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(publicKey) as BufferSource,
      })
      const p256dh = subscription.getKey("p256dh")
      const auth = subscription.getKey("auth")
      if (!p256dh || !auth) throw new Error("The browser did not provide notification keys.")
      const futureExpiration = subscription.expirationTime && subscription.expirationTime > Date.now()
        ? new Date(subscription.expirationTime).toISOString()
        : null
      const supabase = createClient()
      const { data, error } = await supabase.rpc("register_push_subscription", {
        p_auth_secret: bytesToBase64Url(auth),
        p_device_label: pushDeviceLabel(platform),
        p_endpoint: subscription.endpoint,
        p_expires_at: futureExpiration,
        p_p256dh: bytesToBase64Url(p256dh),
        p_platform: platform,
      })
      if (error || typeof data !== "string") {
        if (!priorSubscription) await subscription.unsubscribe().catch(() => false)
        if (error?.message?.includes("PUSH_DEVICE_LIMIT")) {
          const list = await supabase.rpc("list_my_push_subscriptions")
          if (!list.error && Array.isArray(list.data) && list.data.every(isDeviceRow)) {
            setDevices(list.data)
          }
          setState("limit")
          return
        }
        throw new Error("This device could not be registered.")
      }
      window.localStorage.setItem(storageKey, data)
      setState("on")
    } catch {
      setMessage("We couldn't enable notifications on this device. Please try again.")
      setState("error")
    }
  }

  async function disable() {
    const subscriptionId = window.localStorage.getItem(storageKey)
    if (!subscriptionId) {
      setMessage("This device needs to be enabled again before it can be removed.")
      setState("error")
      return
    }
    setState("working")
    setMessage("")
    try {
      const supabase = createClient()
      const { data, error } = await supabase.rpc("remove_my_push_subscription", {
        p_subscription_id: subscriptionId,
      })
      if (error || data !== true) {
        setMessage("This device could not be removed. Nothing was changed.")
        setState("on-error")
        return
      }

      window.localStorage.removeItem(storageKey)
      const subscription = await currentBrowserSubscription()
      if (subscription && !(await subscription.unsubscribe())) {
        throw new Error("The browser could not finish turning notifications off.")
      }
      setDevices((current) => current.filter((row) => row.out_id !== subscriptionId))
      setState("off")
    } catch {
      setMessage("We couldn't finish turning notifications off. Please try again.")
      setState(window.localStorage.getItem(storageKey) ? "on-error" : "error")
    }
  }

  async function removeDevice(subscriptionId: string) {
    setMessage("")
    const { data, error } = await createClient().rpc("remove_my_push_subscription", {
      p_subscription_id: subscriptionId,
    })
    if (error || data !== true) {
      setMessage("That device could not be removed.")
      return
    }
    setDevices((current) => current.filter((row) => row.out_id !== subscriptionId))
  }

  if (state === "checking") return <p role="status" className="text-sm text-muted-foreground">Checking this device…</p>
  if (state === "unsupported") return <InlineAlert variant="info">This browser does not support push notifications.</InlineAlert>
  if (state === "needs-install") return <InlineAlert variant="info">On iPhone, add CEIT Connect to your Home Screen, then open the installed app to enable notifications.</InlineAlert>
  if (state === "blocked") return <InlineAlert variant="warning">Notifications are blocked. Open this site&apos;s browser settings, allow notifications, then return here.</InlineAlert>
  if (state === "unavailable") return <InlineAlert variant="info">We couldn&apos;t check this device. Nothing was changed. Try again later.</InlineAlert>

  return (
    <div className="flex flex-col gap-4 text-sm">
      {state === "on" || state === "on-error" ? (
        <p className="flex items-center gap-2 font-medium text-accent-foreground" role="status">
          <CheckCircle2 className="size-4 text-primary" aria-hidden />
          Notifications are on for this device.
        </p>
      ) : state === "limit" ? (
        <InlineAlert variant="warning">You already have five notification devices. Remove one below, then try again.</InlineAlert>
      ) : state === "working" ? (
        <p role="status" className="text-muted-foreground">Updating this device…</p>
      ) : (
        <p className="text-muted-foreground">Get generic task alerts on this device. Notification previews never include names or task titles.</p>
      )}

      {message ? <InlineAlert>{message}</InlineAlert> : null}

      {state === "on" || state === "on-error" ? (
        <Button type="button" variant="outline" onClick={disable}>Turn off on this device</Button>
      ) : state === "off" || state === "error" || state === "limit" ? (
        <Button type="button" onClick={enable}>Enable notifications</Button>
      ) : null}

      {state === "limit" && devices.length > 0 ? (
        <div className="grid gap-2" aria-label="Your notification devices">
          <p className="font-semibold">Your devices</p>
          {devices.map((device) => (
            <div key={device.out_id} className="flex items-center justify-between gap-3 rounded-xl border p-3">
              <span className="flex min-w-0 items-center gap-2">
                <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{device.out_device_label}</span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void removeDevice(device.out_id)}
              >
                <Trash2 aria-hidden /> Remove
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

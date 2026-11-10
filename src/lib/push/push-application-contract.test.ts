import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { config as proxyConfig } from "@/proxy"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("P1b service worker contract", () => {
  const worker = read("public/sw.js")

  it("always displays validated or fallback content with the supplied tag", () => {
    expect(worker).toContain('self.addEventListener("push"')
    expect(worker).toContain("self.registration.showNotification")
    expect(worker).toContain("FALLBACK_TITLE")
    expect(worker).toContain("FALLBACK_BODY")
    expect(worker).toContain("tag: payload.tag")
  })

  it("has no fetch/cache behavior and navigates only to the fixed root", () => {
    expect(worker).not.toContain('addEventListener("fetch"')
    expect(worker).not.toMatch(/caches\.|CacheStorage/)
    expect(worker).toContain('const FIXED_TARGET = "/"')
    expect(worker).not.toMatch(/payload\.(url|target|address)/)
    expect(worker).not.toContain(".navigate(")
    expect(worker).toContain("await existing.focus()")
    expect(worker).toContain("return self.clients.openWindow(FIXED_TARGET)")
    expect(worker).not.toContain("badge:")
  })
})

describe("P1b route and security source contract", () => {
  const route = read("src/app/api/push/wake/route.ts")
  const sender = read("src/lib/push/push-sender.ts")
  const proxyMatcher = new RegExp(`^${proxyConfig.matcher[0]}$`)

  it("keeps the route Node-only, uncached, immediate, and outside auth proxy", () => {
    expect(route).toContain('runtime = "nodejs"')
    expect(route).toContain('dynamic = "force-dynamic"')
    expect(route).toContain("maxDuration = 60")
    expect(route).toContain("after(() => runPushDeliveryLoop(config))")
    expect(proxyMatcher.test("/api/push/wake")).toBe(false)
    expect(proxyMatcher.test("/sw.js")).toBe(false)
    expect(proxyMatcher.test("/settings")).toBe(true)
  })

  it("uses only the anon client plus capability and never imports service role", () => {
    expect(sender).toContain('"x-ceit-push-capability"')
    expect(sender).toContain('requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY")')
    expect(`${route}\n${sender}`).not.toMatch(/createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/)
  })

  it("pins exact RPC parameter names", () => {
    expect(sender).toContain('p_limit: PUSH_CLAIM_LIMIT')
    expect(sender).toContain('p_delivery_id: delivery.out_delivery_id')
    expect(sender).toContain('p_lease_token: delivery.out_lease_token')
    expect(sender).toContain('p_outcome: result.outcome')
    expect(sender).toContain('p_http_status: result.httpStatus')
    expect(sender).toContain('{ p_run_id: runId, p_run_token: runToken }')
  })
})

describe("P1b Settings and sign-out interaction contract", () => {
  const settings = read("src/components/settings/push-notifications-control.tsx")
  const signOut = read("src/lib/push/push-sign-out.ts")

  it("requests permission before changing Enable state and never registers on load", () => {
    const enable = settings.slice(settings.indexOf("async function enable"), settings.indexOf("async function disable"))
    expect(enable.indexOf("Notification.requestPermission()")).toBeLessThan(enable.indexOf('setState("working")'))
    const loadStart = settings.indexOf("async function loadState()")
    const loadEnd = settings.indexOf("\n    void loadState()", loadStart)
    expect(loadStart).not.toBe(-1)
    expect(loadEnd).not.toBe(-1)
    const load = settings.slice(loadStart, loadEnd)
    expect(load.length).toBeGreaterThan(0)
    expect(load).not.toContain("register_push_subscription")
    expect(load).not.toContain("serviceWorker.register(")
    expect(load).not.toContain("pushManager.subscribe(")
  })

  it("hides Enable for uninstalled iPhones and exposes the neutral check failure", () => {
    expect(settings).toContain('platform === "ios" && !isInstalledApp()')
    expect(settings).toContain('state === "needs-install"')
    expect(settings).toContain("We couldn&apos;t check this device. Nothing was changed.")
    expect(settings).toContain('state === "error" || state === "limit"')
    expect(settings).not.toContain("error instanceof Error ? error.message")
  })

  it("removes the stored id before browser unsubscribe and never re-registers on Disable", () => {
    const disable = settings.slice(settings.indexOf("async function disable"), settings.indexOf("async function removeDevice"))
    expect(disable).toContain("p_subscription_id: subscriptionId")
    expect(disable.indexOf("remove_my_push_subscription")).toBeLessThan(disable.indexOf("subscription.unsubscribe()"))
    expect(disable).not.toContain("register_push_subscription")
  })

  it("bounds sign-out, clears local state, and preserves the native POST surface", () => {
    expect(signOut).toContain("Promise.race")
    expect(signOut).toContain("window.localStorage.removeItem(storageKey)")
    const form = read("src/components/layout/push-aware-sign-out-form.tsx")
    expect(form).toContain('action="/auth/signout"')
    expect(form).toContain('method="post"')
    const cleanupCall = form.indexOf("await bestEffortPushSignOut(userId)")
    const formSubmit = form.indexOf("form.submit()")
    expect(cleanupCall).not.toBe(-1)
    expect(formSubmit).not.toBe(-1)
    expect(cleanupCall).toBeLessThan(formSubmit)
  })
})

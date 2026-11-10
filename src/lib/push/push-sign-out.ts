import { createClient } from "@/lib/supabase/client"
import { pushDeviceStorageKey } from "@/lib/push/push-browser"

type SignOutDependencies = {
  getBrowserSubscription: () => Promise<PushSubscription | null>
  removeDatabaseSubscription: (subscriptionId: string) => Promise<void>
}

function defaultDependencies(): SignOutDependencies {
  return {
    async getBrowserSubscription() {
      if (!("serviceWorker" in navigator)) return null
      const registration = await navigator.serviceWorker.getRegistration("/sw.js")
      return registration?.pushManager.getSubscription() ?? null
    },
    async removeDatabaseSubscription(subscriptionId) {
      const { error } = await createClient().rpc("remove_my_push_subscription", {
        p_subscription_id: subscriptionId,
      })
      if (error) throw error
    },
  }
}

export async function bestEffortPushSignOut(
  userId: string,
  timeoutMs = 3_000,
  dependencies: SignOutDependencies = defaultDependencies(),
) {
  const storageKey = pushDeviceStorageKey(userId)
  const cleanup = async () => {
    let subscriptionId: string | null = null
    try {
      subscriptionId = window.localStorage.getItem(storageKey)
    } catch {
      // Storage can be unavailable in hardened/private browser contexts.
    }
    if (subscriptionId) {
      try {
        await dependencies.removeDatabaseSubscription(subscriptionId)
      } catch {
        // Sign-out must continue; browser unsubscribe below prevents delivery.
      }
    }
    try {
      await (await dependencies.getBrowserSubscription())?.unsubscribe()
    } catch {
      // The database lease/404 cleanup remains a second safety net.
    }
  }

  let timeoutHandle: number | undefined
  const timeout = new Promise<void>((resolve) => {
    timeoutHandle = window.setTimeout(resolve, timeoutMs)
  })
  try {
    await Promise.race([
      cleanup(),
      timeout,
    ])
  } catch {
    // Cleanup is best effort; the form owns the authoritative session sign-out.
  } finally {
    if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle)
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // A storage failure must not escape and block the sign-out form.
    }
  }
}

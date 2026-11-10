import { createHash, timingSafeEqual } from "node:crypto"
import { after } from "next/server"
import { preparePushSender, runPushDeliveryLoop } from "@/lib/push/push-sender"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0
export const maxDuration = 60

function safeSecretMatch(presented: string | null, expected: string | undefined) {
  if (!presented || !expected) return false
  const left = createHash("sha256").update(presented, "utf8").digest()
  const right = createHash("sha256").update(expected, "utf8").digest()
  return timingSafeEqual(left, right)
}

export async function POST(request: Request) {
  if (!safeSecretMatch(
    request.headers.get("x-ceit-wake-secret"),
    process.env.PUSH_WAKE_SECRET,
  )) {
    return Response.json({ error: "Unauthorized." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    })
  }

  try {
    // VAPID is validated before scheduling after() and, critically, before the
    // background worker can claim any queued row.
    const config = preparePushSender()
    after(() => runPushDeliveryLoop(config))
  } catch {
    console.error("Push wake configuration failed.", { claimed: 0 })
    return Response.json({ error: "Push sender unavailable." }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    })
  }

  return Response.json({ accepted: true }, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  })
}

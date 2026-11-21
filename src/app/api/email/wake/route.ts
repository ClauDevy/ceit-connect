import { createHash, timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import {
  emailDatabaseReady,
  prepareImportantEmailSender,
  runImportantEmailDelivery,
} from "@/lib/email/important-email-worker";
import { runActivityLogBackupDelivery } from "@/lib/activity-log-backup-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function safeSecretMatch(presented: string | null, expected: string | undefined) {
  if (!presented || !expected) return false;
  const left = createHash("sha256").update(presented, "utf8").digest();
  const right = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(left, right);
}

export async function POST(request: Request) {
  if (!safeSecretMatch(
    request.headers.get("x-ceit-email-wake-secret"),
    process.env.EMAIL_WAKE_SECRET,
  )) {
    return Response.json({ error: "Unauthorized." }, {
      status: 401,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const config = prepareImportantEmailSender();
    if (!await emailDatabaseReady(config)) throw new Error("Email database unavailable.");
    after(async () => {
      await Promise.allSettled([
        runImportantEmailDelivery(config),
        runActivityLogBackupDelivery(config),
      ]);
    });
  } catch {
    console.error("Important email wake unavailable.", { claimed: 0 });
    return Response.json({ error: "Email sender unavailable." }, {
      status: 500,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json({ accepted: true }, {
    status: 202,
    headers: { "Cache-Control": "no-store" },
  });
}

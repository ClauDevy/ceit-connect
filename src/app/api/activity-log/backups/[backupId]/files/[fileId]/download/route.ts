import { createHash } from "node:crypto";
import { getActiveProfileForRoles, getAuthUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _request: Request,
  context: { params: Promise<{ backupId: string; fileId: string }> },
) {
  const user = await getAuthUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  const profile = await getActiveProfileForRoles(["Admin"]);
  if (!profile) return Response.json({ error: "Activity Log administration is unavailable." }, { status: 403 });

  const { backupId, fileId } = await context.params;
  const supabase = await createClient();
  const listed = await supabase.rpc("list_activity_log_backup_files", {
    p_backup_id: backupId,
  });
  if (listed.error || !Array.isArray(listed.data)) {
    return Response.json({ error: "The backup file is unavailable." }, { status: 404 });
  }
  const file = listed.data.find((row) => row && typeof row === "object" &&
    (row as Record<string, unknown>).file_id === fileId) as Record<string, unknown> | undefined;
  if (!file || typeof file.object_path !== "string" ||
      typeof file.sha256_hex !== "string" || !/^[0-9a-f]{64}$/.test(file.sha256_hex)) {
    return Response.json({ error: "The backup file is unavailable." }, { status: 404 });
  }

  const downloaded = await supabase.storage.from("activity-log-backups").download(file.object_path);
  if (downloaded.error) {
    return Response.json({ error: "The backup file is unavailable." }, { status: 404 });
  }
  const bytes = await downloaded.data.arrayBuffer();
  const actualHash = createHash("sha256").update(new Uint8Array(bytes)).digest("hex");
  if (actualHash !== file.sha256_hex) {
    return Response.json({ error: "The backup file failed its integrity check." }, { status: 409 });
  }
  const recorded = await supabase.rpc("record_activity_log_backup_download", {
    p_file_id: fileId,
  });
  if (recorded.error || recorded.data !== true) {
    return Response.json({ error: "The backup download could not be recorded." }, { status: 500 });
  }
  const filename = file.object_path.split("/").at(-1) ?? "activity-log-backup.csv";
  return new Response(bytes, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename.replaceAll('"', '')}"`,
      "Content-Type": "text/csv; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

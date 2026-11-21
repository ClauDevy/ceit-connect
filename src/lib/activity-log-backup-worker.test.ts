import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const sendResendEmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email/resend-sender", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/email/resend-sender")>();
  return { ...actual, sendResendEmail: sendResendEmailMock };
});
import {
  ACTIVITY_BACKUP_DATABASE_TIMEOUT_MS,
  ACTIVITY_BACKUP_MAX_BYTES,
  ACTIVITY_BACKUP_MAX_FILES_PER_WAKE,
  ACTIVITY_BACKUP_MAX_ROWS,
  activityBackupFetch,
  buildBoundedActivityBackupCsv,
  sendBackupEmail,
} from "@/lib/activity-log-backup-worker";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sendResendEmailMock.mockReset();
});

function row(index: number, title = `Task ${index}`) {
  return {
    activity_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    activity_created_at: "2026-11-21T00:00:00.000Z",
    action: "UPDATE",
    task_title: title,
    event_name: "Event",
    committee_name: "Committee",
    actor_name: "Admin",
    change_summary: "Task updated",
  };
}

function buildAllBoundedFiles(
  candidates: ReturnType<typeof row>[],
  limits?: { maxRows: number; maxBytes: number },
) {
  const files: ReturnType<typeof buildBoundedActivityBackupCsv>[] = [];
  let offset = 0;
  const maxBytes = limits?.maxBytes ?? ACTIVITY_BACKUP_MAX_BYTES;
  while (offset < candidates.length) {
    const file = limits
      ? buildBoundedActivityBackupCsv(candidates.slice(offset), limits)
      : buildBoundedActivityBackupCsv(candidates.slice(offset));
    expect(file.bytes.byteLength).toBeLessThanOrEqual(maxBytes);
    expect(file.rows.length).toBeGreaterThan(0);
    const nextOffset = offset + file.rows.length;
    expect(nextOffset).toBeGreaterThan(offset);
    files.push(file);
    offset = nextOffset;
  }
  const inputIds = candidates.map((candidate) => candidate.activity_id);
  const outputIds = files.flatMap((file) => file.rows.map((candidate) => candidate.activity_id));
  expect(outputIds).toEqual(inputIds);
  expect(new Set(outputIds).size).toBe(inputIds.length);
  return files;
}

describe("Activity Log backup file bounds", () => {
  it("exports formula-safe UTF-8 BOM CSV", () => {
    const result = buildBoundedActivityBackupCsv([row(1, "=SUM(A1:A2)")]);
    expect(new TextDecoder().decode(result.bytes)).toContain('"\'=SUM(A1:A2)"');
    expect([...result.bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("round-trips BOM and non-ASCII CSV bytes through the 30-second backup fetch", async () => {
    const bytes = new TextEncoder().encode("\uFEFFtask_title\r\n\"CafÃ© â€“ Î”\"\r\n");
    let stored = new Uint8Array();
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        stored = new Uint8Array(await new Response(init.body).arrayBuffer());
        return new Response(null, { status: 200 });
      }
      return new Response(stored, { status: 200 });
    }));

    const uploaded = await activityBackupFetch("https://example.test/object.csv", {
      method: "PUT",
      body: bytes,
    });
    expect(uploaded.ok).toBe(true);
    const downloaded = await activityBackupFetch("https://example.test/object.csv");
    expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes);
    expect(ACTIVITY_BACKUP_DATABASE_TIMEOUT_MS).toBe(30_000);
  });

  it("makes the row, byte, and per-wake caps injectable", () => {
    const rows = Array.from({ length: 6 }, (_, index) => row(index + 1));
    expect(buildBoundedActivityBackupCsv(rows, { maxRows: 2, maxBytes: 10_000 }).rows).toHaveLength(2);
    expect(buildBoundedActivityBackupCsv(rows, { maxRows: 6, maxBytes: 220 }).rows.length).toBeLessThan(6);
    expect(ACTIVITY_BACKUP_MAX_ROWS).toBe(5_000);
    expect(ACTIVITY_BACKUP_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(ACTIVITY_BACKUP_MAX_FILES_PER_WAKE).toBe(4);
  });

  it("splits a fixture larger than 5,000 rows into multiple bounded files", () => {
    const pending = Array.from({ length: 5_001 }, (_, index) => row(index + 1));
    const first = buildBoundedActivityBackupCsv(pending, { maxRows: 5_000, maxBytes: 20_000_000 });
    const second = buildBoundedActivityBackupCsv(pending.slice(first.rows.length), {
      maxRows: 5_000,
      maxBytes: 20_000_000,
    });
    expect(first.rows).toHaveLength(5_000);
    expect(second.rows).toHaveLength(1);
  });

  it("splits multibyte rows by an injected byte cap without losing progress", () => {
    const rows = Array.from({ length: 24 }, (_, index) =>
      row(index + 1, `Gawain ${index + 1} ${"界🙂".repeat(20)}`));
    const files = buildAllBoundedFiles(rows, { maxRows: 24, maxBytes: 900 });

    expect(files.length).toBeGreaterThan(1);
    expect(files[0].rows.length).toBeLessThan(rows.length);
    expect(files.every((file) => file.bytes.byteLength <= 900)).toBe(true);
  });

  it("enforces the default five-MiB cap across multibyte continuation files", () => {
    const rows = Array.from({ length: 3_200 }, (_, index) =>
      row(index + 1, `Gawain ${index + 1} ${"🙂漢字".repeat(200)}`));
    const files = buildAllBoundedFiles(rows);

    expect(files.length).toBeGreaterThan(1);
    expect(files.every((file) =>
      file.bytes.byteLength <= ACTIVITY_BACKUP_MAX_BYTES)).toBe(true);
  });

  it("keeps confidential fixtures content-free when fed the database-safe shape", () => {
    const confidential = {
      ...row(1, "Confidential Task"),
      event_name: null,
      committee_name: null,
      actor_name: null,
      change_summary: "Confidential Task activity",
    };
    const csv = new TextDecoder().decode(buildBoundedActivityBackupCsv([confidential]).bytes);
    expect(csv).toContain("Confidential Task");
    expect(csv).not.toContain("Secret title");
    expect(csv).not.toContain("raw changes");
  });
});

const config = {
  anonKey: "anon",
  apiKey: "resend",
  capability: "capability",
  from: "CEIT Connect <noreply@example.test>",
  siteUrl: "https://example.test",
  supabaseUrl: "https://supabase.example.test",
};
const claim = {
  out_backup_id: "00000000-0000-4000-8000-000000000901",
  out_kind: "manual_all" as const,
  out_status: "email_pending" as const,
  out_fixed_cutoff_at: "2026-11-21T00:00:00.000Z",
  out_lease_token: "00000000-0000-4000-8000-000000000902",
};
const limits = {
  maxRows: 5_000,
  maxBytes: 5 * 1024 * 1024,
  maxFilesPerWake: 4,
  maxAttachmentBytes: 20 * 1024 * 1024,
};

describe("Activity Log backup email outcomes", () => {
  it("acknowledges a prepare RPC error as transient", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { message: "timeout" } })
      .mockResolvedValueOnce({ data: true, error: null });
    const client = { rpc, storage: { from: vi.fn() } };

    await sendBackupEmail(client as never, config, claim, limits);

    expect(sendResendEmailMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("acknowledge_activity_log_backup_email", {
      p_backup_id: claim.out_backup_id,
      p_lease_token: claim.out_lease_token,
      p_outcome: "transient",
      p_http_status: null,
    });
  });

  it("does not send partial attachments when a download fails", async () => {
    const prepared = {
      out_recipients: ["admin@example.test"],
      out_file_ids: [
        "00000000-0000-4000-8000-000000000911",
        "00000000-0000-4000-8000-000000000912",
      ],
      out_object_paths: ["backup/part-0001.csv", "backup/part-0002.csv"],
      out_filenames: ["part-0001.csv", "part-0002.csv"],
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [prepared], error: null })
      .mockResolvedValueOnce({ data: Buffer.from("first").toString("base64"), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "payload read failed" } })
      .mockResolvedValueOnce({ data: true, error: null });
    const client = { rpc, storage: { from: vi.fn() } };

    await sendBackupEmail(client as never, config, claim, limits);

    expect(sendResendEmailMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("acknowledge_activity_log_backup_email", {
      p_backup_id: claim.out_backup_id,
      p_lease_token: claim.out_lease_token,
      p_outcome: "transient",
      p_http_status: null,
    });
  });

  it("lists only files omitted by attachment caps", async () => {
    const prepared = {
      out_recipients: ["admin@example.test"],
      out_file_ids: [
        "00000000-0000-4000-8000-000000000911",
        "00000000-0000-4000-8000-000000000912",
      ],
      out_object_paths: ["backup/part-0001.csv", "backup/part-0002.csv"],
      out_filenames: ["part-0001.csv", "part-0002.csv"],
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [prepared], error: null })
      .mockResolvedValueOnce({ data: Buffer.from("one").toString("base64"), error: null })
      .mockResolvedValueOnce({ data: Buffer.from("second").toString("base64"), error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const client = { rpc, storage: { from: vi.fn() } };
    sendResendEmailMock.mockResolvedValueOnce({ outcome: "success", httpStatus: 200 });

    await sendBackupEmail(client as never, config, claim, {
      ...limits,
      maxAttachmentBytes: 5,
    });

    expect(sendResendEmailMock).toHaveBeenCalledOnce();
    const message = sendResendEmailMock.mock.calls[0][1];
    expect(message.attachments).toHaveLength(1);
    expect(message.text).toContain("- part-0002.csv");
    expect(message.text).not.toContain("- part-0001.csv");
  });

  it("keeps a valid zero-recipient response terminal", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: [{
        out_recipients: [], out_file_ids: [], out_object_paths: [], out_filenames: [],
      }], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const client = { rpc, storage: { from: vi.fn() } };

    await sendBackupEmail(client as never, config, claim, limits);

    expect(sendResendEmailMock).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenLastCalledWith("acknowledge_activity_log_backup_email", {
      p_backup_id: claim.out_backup_id,
      p_lease_token: claim.out_lease_token,
      p_outcome: "permanent",
      p_http_status: 400,
    });
  });
});

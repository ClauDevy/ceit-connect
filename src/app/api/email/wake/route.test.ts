import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  ready: vi.fn(),
  prepare: vi.fn(),
  run: vi.fn(),
  runBackup: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/important-email-worker", () => ({
  emailDatabaseReady: mocks.ready,
  prepareImportantEmailSender: mocks.prepare,
  runImportantEmailDelivery: mocks.run,
}));
vi.mock("@/lib/activity-log-backup-worker", () => ({
  runActivityLogBackupDelivery: mocks.runBackup,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

import { POST } from "./route";

function request(secret?: string, body = "ignored") {
  return new Request("http://localhost/api/email/wake", {
    method: "POST",
    headers: secret ? { "x-ceit-email-wake-secret": secret } : undefined,
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMAIL_WAKE_SECRET = "correct-secret";
  mocks.prepare.mockReturnValue({ ready: true });
  mocks.ready.mockResolvedValue(true);
  mocks.after.mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("POST /api/email/wake", () => {
  it.each([undefined, "wrong-secret"])("rejects %s before configuration", async (secret) => {
    expect((await POST(request(secret))).status).toBe(401);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("returns a generic 500 before the migration is available", async () => {
    mocks.ready.mockResolvedValue(false);
    const response = await POST(request("correct-secret"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "Email sender unavailable." });
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("ignores the body and schedules work only after readiness", async () => {
    let scheduled: (() => unknown) | undefined;
    mocks.after.mockImplementation((callback) => { scheduled = callback; });
    const response = await POST(request("correct-secret", "not-json"));
    expect(response.status).toBe(202);
    expect(mocks.run).not.toHaveBeenCalled();
    await scheduled?.();
    expect(mocks.run).toHaveBeenCalledWith({ ready: true });
    expect(mocks.runBackup).toHaveBeenCalledWith({ ready: true });
  });

  it("isolates an uncaught backup worker failure while important email still runs", async () => {
    let scheduled: (() => unknown) | undefined;
    mocks.after.mockImplementation((callback) => { scheduled = callback; });
    mocks.runBackup.mockRejectedValueOnce(new Error("missing RPC"));
    const response = await POST(request("correct-secret"));
    expect(response.status).toBe(202);
    await scheduled?.();
    expect(mocks.run).toHaveBeenCalledWith({ ready: true });
  });

  it("returns 202 when the real backup worker receives a missing-RPC error", async () => {
    let scheduled: (() => unknown) | undefined;
    mocks.after.mockImplementation((callback) => { scheduled = callback; });
    const rpc = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { code: "PGRST202", message: "claim_activity_log_backup is unavailable" },
    });
    mocks.createClient.mockReturnValue({ rpc });
    const actual = await vi.importActual<typeof import("@/lib/activity-log-backup-worker")>(
      "@/lib/activity-log-backup-worker",
    );
    mocks.runBackup.mockImplementationOnce(actual.runActivityLogBackupDelivery);
    vi.spyOn(console, "info").mockImplementation(() => undefined);

    const response = await POST(request("correct-secret"));
    expect(response.status).toBe(202);
    await scheduled?.();

    expect(mocks.run).toHaveBeenCalledWith({ ready: true });
    expect(rpc).toHaveBeenCalledWith("claim_activity_log_backup");
  });
});

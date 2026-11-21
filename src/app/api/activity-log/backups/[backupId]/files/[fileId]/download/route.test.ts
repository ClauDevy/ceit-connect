import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  getAuthUser: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
  getAuthUser: mocks.getAuthUser,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "./route";

const backupId = "92000000-0000-4000-8000-000000000901";
const fileId = "92000000-0000-4000-8000-000000000902";
const objectPath = `manual/${backupId}/activity-log-part-0001.csv`;
const fileBytes = new TextEncoder().encode("activity_id,action\n1,UPDATE\n");
const expectedHash = createHash("sha256").update(fileBytes).digest("hex");

function setupDownload(sha256Hex = expectedHash) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "list_activity_log_backup_files") {
      return {
        data: [{ file_id: fileId, object_path: objectPath, sha256_hex: sha256Hex }],
        error: null,
      };
    }
    if (name === "record_activity_log_backup_download") {
      return { data: true, error: null };
    }
    throw new Error(`unexpected RPC ${name}`);
  });
  const download = vi.fn().mockResolvedValue({
    data: new Blob([fileBytes], { type: "text/csv" }),
    error: null,
  });
  mocks.createClient.mockResolvedValue({
    rpc,
    storage: { from: vi.fn(() => ({ download })) },
  });
  return { download, rpc };
}

function callRoute() {
  return GET(new Request("http://localhost/download"), {
    params: Promise.resolve({ backupId, fileId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "92000000-0000-4000-8000-000000000903" });
  mocks.getActiveProfileForRoles.mockResolvedValue({ role: "Admin", is_active: true });
});

describe("Activity Log backup download", () => {
  it("returns and records a file whose bytes match the stored SHA-256", async () => {
    const { rpc } = setupDownload();

    const response = await callRoute();

    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(fileBytes);
    expect(rpc).toHaveBeenCalledWith("record_activity_log_backup_download", {
      p_file_id: fileId,
    });
  });

  it("does not record or return a file whose bytes fail SHA-256 verification", async () => {
    const { rpc } = setupDownload("0".repeat(64));

    const response = await callRoute();

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "The backup file failed its integrity check.",
    });
    expect(rpc).not.toHaveBeenCalledWith(
      "record_activity_log_backup_download",
      expect.anything(),
    );
  });
});

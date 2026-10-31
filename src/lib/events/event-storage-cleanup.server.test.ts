import { describe, expect, it, vi } from "vitest";
import {
  attemptEventStorageCleanup,
  runEventStorageCleanupPass,
} from "./event-storage-cleanup.server";

function claimed(n = 1) {
  return [{
    out_job_id: `13dc0000-0000-4000-8000-${n.toString().padStart(12, "0")}`,
    out_event_id: "13dc1000-0000-4000-8000-000000000001",
    out_bucket_id: "banners",
    out_object_path: "13dc1000-0000-4000-8000-000000000001/file.webp",
    out_claim_token: `13dc2000-0000-4000-8000-${n.toString().padStart(12, "0")}`,
  }];
}

describe("event Storage cleanup server workflow", () => {
  it("uses only claimed bucket/path and finalizes done with the claim token", async () => {
    const remove = vi.fn().mockResolvedValue({ data: [], error: null });
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: claimed(), error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const client = { rpc, storage: { from: vi.fn(() => ({ remove })) } };
    const result = await attemptEventStorageCleanup(client as never, claimed()[0].out_job_id);
    expect(remove).toHaveBeenCalledWith([claimed()[0].out_object_path]);
    expect(client.storage.from).toHaveBeenCalledWith("banners");
    expect(rpc).toHaveBeenNthCalledWith(2, "finalize_event_storage_cleanup_job", {
      p_job_id: claimed()[0].out_job_id,
      p_claim_token: claimed()[0].out_claim_token,
      p_outcome: "done",
      p_last_error: null,
    });
    expect(result.status).toBe("done");
  });

  it("stores only fixed sanitized text for Storage failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: claimed(), error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const client = {
      rpc,
      storage: { from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ data: null, error: { name: "private-provider-message" } }) })) },
    };
    const result = await attemptEventStorageCleanup(client as never, claimed()[0].out_job_id);
    expect(rpc).toHaveBeenNthCalledWith(2, "finalize_event_storage_cleanup_job", expect.objectContaining({
      p_outcome: "failed", p_last_error: "Storage cleanup failed.",
    }));
    expect(result.status).toBe("failed");
    expect(result.message).not.toContain("private-provider-message");
  });

  it("maps CCE10 finalize errors by code and leaves the job pending", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: claimed(), error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "CCE10", message: "private rejected value" } });
    const client = {
      rpc,
      storage: { from: vi.fn(() => ({ remove: vi.fn().mockResolvedValue({ data: [], error: null }) })) },
    };
    const result = await attemptEventStorageCleanup(client as never, claimed()[0].out_job_id);
    expect(result).toMatchObject({ status: "pending", message: "The banner cleanup result could not be saved safely." });
    expect(result.message).not.toContain("private rejected value");
  });

  it("runs sequentially and never claims more than twenty jobs", async () => {
    const sequence: string[] = [];
    let claimNumber = 0;
    const rpc = vi.fn(async (name: string) => {
      sequence.push(name === "claim_event_storage_cleanup_job" ? `claim-${claimNumber + 1}` : `finalize-${claimNumber}`);
      if (name === "claim_event_storage_cleanup_job") {
        claimNumber += 1;
        return { data: claimed(claimNumber), error: null };
      }
      return { data: true, error: null };
    });
    const remove = vi.fn(async () => {
      sequence.push(`remove-${claimNumber}`);
      return { data: [], error: null };
    });
    const client = { rpc, storage: { from: vi.fn(() => ({ remove })) } };
    const result = await runEventStorageCleanupPass(client as never, { limit: 99 });
    expect(result).toEqual({ attempted: 20, done: 20, failed: 0, timedOut: false });
    expect(sequence.slice(0, 6)).toEqual([
      "claim-1", "remove-1", "finalize-1", "claim-2", "remove-2", "finalize-2",
    ]);
    expect(claimNumber).toBe(20);
  });

  it("stops before claiming when the time budget is exhausted", async () => {
    const rpc = vi.fn();
    const client = { rpc, storage: { from: vi.fn() } };
    await expect(runEventStorageCleanupPass(client as never, { timeBudgetMs: 0 })).resolves.toEqual({
      attempted: 0, done: 0, failed: 0, timedOut: true,
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

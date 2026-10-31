import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
  countPendingCleanupJobs: vi.fn(),
  runEventStorageCleanupPass: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  createServiceRoleClient: mocks.createServiceRoleClient,
}));
vi.mock("@/lib/events/event-storage-cleanup.server", () => ({
  countPendingCleanupJobs: mocks.countPendingCleanupJobs,
  runEventStorageCleanupPass: mocks.runEventStorageCleanupPass,
}));

import { POST, maxDuration } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/event-storage-cleanup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function caller(profile: unknown = { role: "Admin", is_active: true }) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin-id" } }, error: null }) },
    from: vi.fn(() => ({ select })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  caller();
  mocks.createServiceRoleClient.mockResolvedValue({ service: true });
  mocks.countPendingCleanupJobs.mockResolvedValue(4);
  mocks.runEventStorageCleanupPass.mockResolvedValue({ attempted: 2, done: 1, failed: 1, timedOut: false });
});

describe("event storage cleanup route", () => {
  it("has an explicit route duration", () => expect(maxDuration).toBe(30));

  it.each([
    [null],
    [{ role: "Admin", is_active: false }],
    [{ role: "Co-Admin", is_active: true }],
    [{ role: "Member", is_active: true }],
  ])("denies profile-less and non-active-Admin callers before service-role creation", async (profile) => {
    caller(profile);
    const response = await POST(request({ action: "status" }));
    expect(response.status).toBe(403);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("denies unauthenticated callers before service-role creation", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }) },
    });
    const response = await POST(request({ action: "status" }));
    expect(response.status).toBe(401);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: "unknown" }],
    [{ action: "status", extra: true }],
    [{}],
    [null],
  ])("rejects unknown shapes with fixed text before service-role creation", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid cleanup request." });
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns only the pending count for status", async () => {
    const response = await POST(request({ action: "status" }));
    expect(await response.json()).toEqual({ pendingCount: 4 });
    expect(mocks.runEventStorageCleanupPass).not.toHaveBeenCalled();
  });

  it("runs the bounded retry pass and refreshes the count", async () => {
    mocks.runEventStorageCleanupPass.mockResolvedValueOnce({
      attempted: 2,
      done: 1,
      failed: 1,
      timedOut: true,
    });
    const response = await POST(request({ action: "retry" }));
    expect(await response.json()).toEqual({ attempted: 2, done: 1, failed: 1, timedOut: true, pendingCount: 4 });
    expect(mocks.runEventStorageCleanupPass).toHaveBeenCalledTimes(1);
    const timeBudgetMs = mocks.runEventStorageCleanupPass.mock.calls[0]?.[1]?.timeBudgetMs;
    expect(Number.isFinite(timeBudgetMs)).toBe(true);
    expect(timeBudgetMs).toBeGreaterThan(0);
    expect(timeBudgetMs).toBeLessThan(maxDuration * 1000);
    expect(mocks.countPendingCleanupJobs).toHaveBeenCalledTimes(1);
    expect(mocks.runEventStorageCleanupPass.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.countPendingCleanupJobs.mock.invocationCallOrder[0]);
  });

  it("returns fixed safe text when the service workflow fails", async () => {
    mocks.countPendingCleanupJobs.mockRejectedValue(new Error("private provider value"));
    const response = await POST(request({ action: "status" }));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private provider value");
  });
});

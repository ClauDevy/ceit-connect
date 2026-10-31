import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
  runEventStorageCleanupPass: vi.fn(),
  attemptEventStorageCleanup: vi.fn(),
  countPendingCleanupJobs: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  createServiceRoleClient: mocks.createServiceRoleClient,
}));
vi.mock("@/lib/events/event-storage-cleanup.server", () => ({
  runEventStorageCleanupPass: mocks.runEventStorageCleanupPass,
  attemptEventStorageCleanup: mocks.attemptEventStorageCleanup,
  countPendingCleanupJobs: mocks.countPendingCleanupJobs,
}));

import { POST, maxDuration } from "./route";

const eventId = "13de0000-0000-4000-8000-000000000001";
const secondId = "13de0000-0000-4000-8000-000000000002";
const actorId = "13de0000-0000-4000-8000-000000000099";
const version = "2026-10-31T12:34:56.123456+00:00";

function request(body: unknown) {
  return new Request("http://localhost/api/event-deletion", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

function body(events = [{ id: eventId, expectedUpdatedAt: version }], confirmation = "Foundation Week") {
  return { events, confirmation };
}

function caller(profile: unknown = { role: "Admin", is_active: true }) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: profile, error: null });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: actorId } }, error: null }) },
    from: vi.fn(() => ({ select })),
  });
}

function service(rows: unknown[] = [{ id: eventId, name: "Foundation Week", status: "Draft", updated_at: version }]) {
  const inFilter = vi.fn().mockResolvedValue({ data: rows, error: null });
  const select = vi.fn(() => ({ in: inFilter }));
  const rpc = vi.fn(async (name: string) => {
    if (name === "delete_event") return { data: [{ out_event_id: eventId, out_cleanup_job_id: null, out_cleanup_unavailable: false }], error: null };
    throw new Error(`unexpected ${name}`);
  });
  const client = { from: vi.fn(() => ({ select })), rpc };
  mocks.createServiceRoleClient.mockResolvedValue(client);
  return { client, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  caller();
  service();
  mocks.runEventStorageCleanupPass.mockResolvedValue({ attempted: 0, done: 0, failed: 0, timedOut: false });
  mocks.attemptEventStorageCleanup.mockResolvedValue({ jobId: "job", status: "done", message: "done" });
  mocks.countPendingCleanupJobs.mockResolvedValue(0);
});

describe("event deletion route", () => {
  it("pins the route to 60 seconds", () => expect(maxDuration).toBe(60));

  it.each([
    [null],
    [{ role: "Admin", is_active: false }],
    [{ role: "Co-Admin", is_active: true }],
    [{ role: "Member", is_active: true }],
  ])("denies non-active-Admin callers before service-role creation", async (profile) => {
    caller(profile);
    const response = await POST(request(body()));
    expect(response.status).toBe(403);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects invalid shapes before service-role creation", async () => {
    const response = await POST(request({ ...body(), actorId, extra: true }));
    expect(response.status).toBe(400);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("requires the current stored name for one event", async () => {
    const response = await POST(request(body(undefined, "old name")));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "The typed confirmation does not match." });
    expect(mocks.runEventStorageCleanupPass).not.toHaveBeenCalled();
  });

  it("uses submitted bulk count even when one event is already gone", async () => {
    const { rpc } = service();
    const response = await POST(request(body([
      { id: eventId, expectedUpdatedAt: version },
      { id: secondId, expectedUpdatedAt: version },
    ], "DELETE 2 EVENTS")));
    const payload = await response.json();
    expect(payload.results).toHaveLength(2);
    expect(payload.results[1].message).toBe("This event is no longer available.");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reports a re-read version mismatch as stale without calling delete_event", async () => {
    const { rpc } = service([{ id: eventId, name: "Foundation Week", status: "Draft", updated_at: "2026-10-31T12:34:57.000001+00:00" }]);
    const response = await POST(request(body()));
    expect((await response.json()).results[0].message).toContain("changed");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("runs the 8-second pre-pass then forwards actor and opaque microsecond version", async () => {
    const { rpc } = service();
    await POST(request(body()));
    expect(mocks.runEventStorageCleanupPass).toHaveBeenCalledWith(expect.anything(), { timeBudgetMs: 8000 });
    expect(rpc).toHaveBeenCalledWith("delete_event", {
      p_event_id: eventId, p_actor_id: actorId, p_expected_updated_at: version,
    });
  });

  it("does not let pre-pass failure block deletion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.runEventStorageCleanupPass.mockRejectedValue(new Error("private cleanup error"));
    const { rpc } = service();
    const response = await POST(request(body()));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("delete_event", expect.anything());
  });

  it("attempts the exact returned cleanup job only after deletion succeeds", async () => {
    const { client } = service();
    client.rpc = vi.fn().mockResolvedValue({ data: [{ out_event_id: eventId, out_cleanup_job_id: "13de9000-0000-4000-8000-000000000001", out_cleanup_unavailable: false }], error: null });
    mocks.createServiceRoleClient.mockResolvedValue(client);
    const response = await POST(request(body()));
    expect(mocks.attemptEventStorageCleanup).toHaveBeenCalledWith(client, "13de9000-0000-4000-8000-000000000001");
    expect((await response.json()).results[0].cleanup).toBe("done");
  });

  it("maps database codes and cleanup warning without exposing messages", async () => {
    const { client } = service();
    client.rpc = vi.fn().mockResolvedValue({ data: null, error: { code: "CCE04", message: "private stored name" } });
    mocks.createServiceRoleClient.mockResolvedValue(client);
    const response = await POST(request(body()));
    const text = JSON.stringify(await response.json());
    expect(text).toContain("Only Draft or Archived");
    expect(text).not.toContain("private stored name");
  });

  it("reports finalized cleanup failure separately from successful deletion", async () => {
    const { client } = service();
    client.rpc = vi.fn().mockResolvedValue({ data: [{ out_event_id: eventId, out_cleanup_job_id: "13de9000-0000-4000-8000-000000000001", out_cleanup_unavailable: false }], error: null });
    mocks.createServiceRoleClient.mockResolvedValue(client);
    mocks.attemptEventStorageCleanup.mockResolvedValue({ jobId: "job", status: "failed", message: "fixed" });
    const payload = await (await POST(request(body()))).json();
    expect(payload.results[0]).toMatchObject({ deletion: "done", cleanup: "failed" });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  createClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { POST } from "./route";

const callerId = "10000000-0000-4000-8000-000000000001";
const targetId = "10000000-0000-4000-8000-000000000002";
const otherCommitteeId = "10000000-0000-4000-8000-000000000003";
const officerId = "10000000-0000-4000-8000-000000000004";

function request(isActive: boolean, userId = targetId, extra = {}) {
  return new Request("http://localhost/api/toggle-user-active", {
    method: "POST",
    body: JSON.stringify({ userId, isActive, ...extra }),
  });
}

function sessionClient(options?: {
  rpcError?: unknown;
  targetRole?: string;
  anonymizedAt?: string | null;
}) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: options?.rpcError ?? null });
  const single = vi.fn().mockResolvedValue({
    data: {
      role: options?.targetRole ?? "Member",
      is_active: false,
      anonymized_at: options?.anonymizedAt ?? null,
    },
    error: null,
  });
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { rpc, from };
  mocks.createClient.mockResolvedValue(client);
  return { client, rpc, from };
}

function serviceClient(authError: unknown = null) {
  const updateUserById = vi.fn().mockResolvedValue({ data: {}, error: authError });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  const eq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn(() => ({ eq }));
  const client = {
    auth: { admin: { updateUserById } },
    storage: { from: vi.fn(() => ({ remove })) },
    from: vi.fn(() => ({ update })),
  };
  mocks.createServiceRoleClient.mockResolvedValue(client);
  return { client, updateUserById, remove, update };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: callerId });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Co-Admin",
    committee_id: "committee-a",
    is_active: true,
  });
  sessionClient();
});

describe("POST /api/toggle-user-active Co-Admin boundary", () => {
  it.each([
    [false, "deactivate_committee_member"],
    [true, "reactivate_committee_member"],
  ])("uses only the caller-session %s RPC", async (isActive, rpcName) => {
    const session = sessionClient();
    const response = await POST(request(isActive));
    expect(response.status).toBe(200);
    expect(session.rpc).toHaveBeenCalledWith(rpcName, { p_user_id: targetId });
    expect(session.from).toHaveBeenCalledTimes(isActive ? 1 : 0);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects an anonymized target before the reactivation RPC", async () => {
    const session = sessionClient({ anonymizedAt: "2026-10-27T12:00:00.000Z" });
    const response = await POST(request(true));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This account cannot be reactivated",
    });
    expect(session.rpc).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each([
    ["officer id", officerId],
    ["other-committee id", otherCommitteeId],
    ["their own id", callerId],
  ])("denies a Co-Admin sending %s without service-role access", async (_label, id) => {
    const session = sessionClient({
      rpcError: { code: "CCM03", message: "private" },
    });
    const response = await POST(request(false, id));
    expect(response.status).toBe(404);
    expect(session.rpc).toHaveBeenCalledWith("deactivate_committee_member", {
      p_user_id: id,
    });
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects avatar, role, and committee authority before the RPC", async () => {
    for (const extra of [
      { avatar_url: null },
      { role: "Member" },
      { committeeId: "committee-a" },
    ]) {
      const session = sessionClient();
      expect((await POST(request(false, targetId, extra))).status).toBe(400);
      expect(session.rpc).not.toHaveBeenCalled();
    }
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("denies signed-out and inactive callers before data clients", async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await POST(request(false))).status).toBe(401);
    mocks.getAuthUser.mockResolvedValue({ id: callerId });
    mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
    expect((await POST(request(false))).status).toBe(403);
  });
});

describe("POST /api/toggle-user-active Admin regression", () => {
  beforeEach(() => {
    mocks.getActiveProfileForRoles.mockResolvedValue({
      role: "Admin",
      committee_id: null,
      is_active: true,
    });
  });

  it("keeps the officer RPC, Auth ban, and avatar removal path", async () => {
    const session = sessionClient({ targetRole: "Co-Admin" });
    const service = serviceClient();
    const response = await POST(request(false));
    expect(response.status).toBe(200);
    expect(session.rpc).toHaveBeenCalledWith("set_officer_active", {
      p_user_id: targetId,
      p_is_active: false,
    });
    expect(service.updateUserById).toHaveBeenCalledWith(targetId, {
      ban_duration: "876000h",
    });
    expect(service.remove).toHaveBeenCalledWith([`${targetId}/avatar.webp`]);
  });

  it("keeps Admin Member deactivation avatar clearing", async () => {
    sessionClient({ targetRole: "Member" });
    const service = serviceClient();
    const response = await POST(request(false));
    expect(response.status).toBe(200);
    expect(service.update).toHaveBeenCalledWith({
      is_active: false,
      avatar_url: null,
    });
    expect(service.remove).toHaveBeenCalledWith([`${targetId}/avatar.webp`]);
  });

  it("rejects an anonymized target before any Admin service-role write", async () => {
    const session = sessionClient({
      targetRole: "Member",
      anonymizedAt: "2026-10-27T12:00:00.000Z",
    });
    const service = serviceClient();
    const response = await POST(request(true));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This account cannot be reactivated",
    });
    expect(session.rpc).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
    expect(service.updateUserById).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });
});

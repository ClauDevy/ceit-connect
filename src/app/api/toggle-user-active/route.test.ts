import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createClient: vi.fn(), createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { POST } from "./route";

const targetId = "10000000-0000-4000-8000-000000000001";
const request = (isActive: boolean) =>
  new Request("http://localhost/api/toggle-user-active", {
    method: "POST",
    body: JSON.stringify({ userId: targetId, isActive }),
  });

function caller(role: string, targetRole: string, rpcError: unknown = null) {
  let selection = 0;
  const single = vi.fn(async () => ({
    data:
      selection++ % 2 === 0
        ? { role, is_active: true }
        : { role: targetRole, is_active: false },
    error: null,
  }));
  const eq = vi.fn(() => ({ single }));
  const select = vi.fn(() => ({ eq }));
  const rpc = vi.fn().mockResolvedValue({ data: null, error: rpcError });
  mocks.createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: "admin" } } }) },
    from: vi.fn(() => ({ select })),
    rpc,
  });
  return { rpc };
}

function admin(authError: unknown = null) {
  const updateUserById = vi.fn().mockResolvedValue({ data: {}, error: authError });
  const remove = vi.fn().mockResolvedValue({ data: [], error: null });
  mocks.createServiceRoleClient.mockResolvedValue({
    auth: { admin: { updateUserById } },
    storage: { from: vi.fn(() => ({ remove })) },
  });
  return { updateUserById, remove };
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/toggle-user-active officer path", () => {
  it("rejects Admin targets before constructing service role", async () => {
    caller("Admin", "Admin");
    expect((await POST(request(false))).status).toBe(403);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("uses set_officer_active then bans and removes the avatar", async () => {
    const session = caller("Admin", "Co-Admin");
    const service = admin();
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

  it("re-applies the unban after an idempotent RPC no-op retry", async () => {
    const session = caller("Admin", "Co-Admin");
    const service = admin({ message: "first Auth failure" });
    const first = await POST(request(true));
    expect(first.status).toBe(502);
    await expect(first.json()).resolves.toMatchObject({ cleanupPending: true });

    service.updateUserById.mockResolvedValueOnce({ data: {}, error: null });
    const second = await POST(request(true));
    expect(second.status).toBe(200);
    expect(session.rpc).toHaveBeenCalledTimes(2);
    expect(service.updateUserById).toHaveBeenLastCalledWith(targetId, {
      ban_duration: "none",
    });
  });

  it("does not construct service role when the RPC says to cancel an invitation", async () => {
    caller("Admin", "Co-Admin", { code: "CCO03", message: "private" });
    const response = await POST(request(false));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Use Cancel invitation for an unaccepted officer invite.",
    });
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });
});

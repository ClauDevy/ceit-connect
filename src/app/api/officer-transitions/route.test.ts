import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { POST } from "./route";

const userId = "10000000-0000-4000-8000-000000000001";
const committeeId = "20000000-0000-4000-8000-000000000001";
const request = (body: unknown) =>
  new Request("http://localhost/api/officer-transitions", {
    method: "POST",
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "admin" });
  mocks.getActiveProfileForRoles.mockResolvedValue({ role: "Admin", is_active: true });
});

describe("POST /api/officer-transitions", () => {
  it("denies unauthorized callers before constructing the caller client", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValue(null);
    expect((await POST(request({ action: "step-down", committeeId }))).status).toBe(403);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["appoint_member_as_officer", { action: "appoint", userId, role: "Co-Admin", committeeId }],
    ["return_coadmin_to_member", { action: "return-to-member", userId, committeeId }],
    ["move_member_to_committee", { action: "move-committee", userId, committeeId }],
    ["step_down_as_admin", { action: "step-down", committeeId }],
  ])("routes %s through the caller-session client", async (rpcName, body) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    mocks.createClient.mockResolvedValue({ rpc });
    const response = await POST(request(body));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith(rpcName, expect.any(Object));
  });

  it("returns the Home redirect contract after self step-down", async () => {
    mocks.createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const response = await POST(request({ action: "step-down", committeeId }));
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      redirectTo: "/home",
    });
  });

  it("rejects unknown actions and maps database messages safely", async () => {
    expect((await POST(request({ action: "generic-role-change", userId }))).status).toBe(400);
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { code: "CCO09", message: "private database text" },
    });
    mocks.createClient.mockResolvedValue({ rpc });
    const response = await POST(request({ action: "step-down", committeeId }));
    expect(await response.json()).toEqual({
      error: "The last active Admin cannot step down.",
    });
  });
});

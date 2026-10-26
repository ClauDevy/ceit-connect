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
function request(body: unknown = { userId, fullName: "  Trim Me  " }) {
  return new Request("http://localhost/api/update-member-name", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "caller" });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Co-Admin",
    committee_id: "committee",
    is_active: true,
  });
  mocks.createClient.mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: "Trim Me", error: null }),
  });
});

describe("POST /api/update-member-name", () => {
  it("returns the exact normalized name from the caller-session RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: "Trim Me", error: null });
    mocks.createClient.mockResolvedValue({ rpc });
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ fullName: "Trim Me" });
    expect(rpc).toHaveBeenCalledWith("update_committee_member_full_name", {
      p_user_id: userId,
      p_full_name: "  Trim Me  ",
    });
  });

  it.each([
    ["other committee", "CCM03", 404],
    ["officer or own id", "CCM03", 404],
    ["stale caller", "CCM01", 403],
    ["invalid name", "CCM05", 400],
    ["stale write", "CCM09", 409],
  ])("maps %s safely", async (_label, code, status) => {
    mocks.createClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code, message: "private SQL detail" },
      }),
    });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain("private SQL");
  });

  it("denies signed-out, Admin, inactive, Member, and profile-less callers", async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    mocks.getAuthUser.mockResolvedValue({ id: "caller" });
    for (const caller of ["Admin", "inactive", "Member", "profile-less"]) {
      mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
      expect((await POST(request())).status).toBe(403);
      expect(mocks.getActiveProfileForRoles).toHaveBeenLastCalledWith([
        "Co-Admin",
      ]);
      expect(caller).toBeTruthy();
    }
  });

  it("rejects malformed, extra-authority, and invalid UUID bodies before RPC", async () => {
    for (const body of [
      { userId: "not-a-uuid", fullName: "Name" },
      { userId, fullName: 7 },
      { userId, fullName: "Name", committeeId: "other" },
    ]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
  });
});

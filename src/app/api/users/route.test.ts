import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  getAuthUser: vi.fn(),
  listUsersPage: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
  getAuthUser: mocks.getAuthUser,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/users/list-users", async () => {
  const actual = await import("../../../lib/users/list-users");
  return { ...actual, listUsersPage: mocks.listUsersPage };
});

import { GET } from "./route";

function request(query = "status=active&offset=0&search=") {
  return new Request(`http://localhost/api/users?${query}`);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "admin" });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Admin",
    committee_id: null,
    is_active: true,
  });
  mocks.createClient.mockResolvedValue({ rpc: vi.fn() });
  mocks.listUsersPage.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/users", () => {
  it("returns no-store JSON 401 before role and data access", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getActiveProfileForRoles).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  for (const caller of [
    "inactive Admin",
    "inactive Co-Admin",
    "profile-less",
    "Member",
  ]) {
    it(`returns no-store JSON 403 for ${caller}`, async () => {
      mocks.getActiveProfileForRoles.mockResolvedValue(null);
      const response = await GET(request());
      expect(response.status).toBe(403);
      expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith([
        "Admin",
        "Co-Admin",
      ]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });
  }

  it.each(["Admin", "Co-Admin"])(
    "allows an active %s through the caller-session reader",
    async (role) => {
      mocks.getActiveProfileForRoles.mockResolvedValue({
        role,
        committee_id: role === "Co-Admin" ? "committee" : null,
        is_active: true,
      });
      const client = { rpc: vi.fn() };
      mocks.createClient.mockResolvedValue(client);
      const response = await GET(
        request("status=deactivated&offset=20&search=%20CiA%20"),
      );
      expect(response.status).toBe(200);
      expect(mocks.listUsersPage).toHaveBeenCalledWith(client, {
        offset: 20,
        search: "CiA",
        status: "deactivated",
      });
    },
  );

  it.each(["%25", "_", "%5C"])(
    "passes literal search token %s to the reader",
    async (search) => {
      await GET(request(`status=active&offset=0&search=${search}`));
      expect(mocks.listUsersPage).toHaveBeenLastCalledWith(expect.anything(), {
        offset: 0,
        search: decodeURIComponent(search),
        status: "active",
      });
    },
  );

  it.each([
    "status=all&offset=0",
    "status=active&offset=21",
    "status=active&offset=-20",
    "status=active&offset=10020",
    `status=active&offset=0&search=${"x".repeat(101)}`,
  ])("rejects invalid input before data-client construction: %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("fails safely when the reader reports or throws an error", async () => {
    mocks.listUsersPage.mockResolvedValueOnce({
      data: null,
      error: { message: "private" },
    });
    const reported = await GET(request());
    expect(reported.status).toBe(500);
    await expect(reported.json()).resolves.toEqual({
      error: "Users could not be loaded",
    });

    mocks.listUsersPage.mockRejectedValueOnce(new Error("private"));
    expect((await GET(request())).status).toBe(500);
  });
});

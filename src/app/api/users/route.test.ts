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
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.createClient,
}));
vi.mock("@/lib/users/list-users", async () => {
  const actual = await import("../../../lib/users/list-users");
  return { ...actual, listUsersPage: mocks.listUsersPage };
});

import { GET } from "./route";

const committee = {
  id: "123e4567-e89b-42d3-a456-426614174000",
  name: "CIA",
};

function request(query = "status=active&offset=0&search=") {
  return new Request(`http://localhost/api/users?${query}`);
}

function dataClient(
  result: { data: unknown; error: unknown } = {
    data: [committee],
    error: null,
  },
) {
  const order = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  return { client: { from }, from, order, select };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "admin" });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Admin",
    is_active: true,
  });
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

  for (const caller of ["inactive Admin", "profile-less", "Co-Admin", "Member"]) {
    it(`returns no-store JSON 403 for ${caller}`, async () => {
      mocks.getActiveProfileForRoles.mockResolvedValue(null);
      const response = await GET(request());
      expect(response.status).toBe(403);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith(["Admin"]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });
  }

  it.each([
    "status=all&offset=0",
    "status=active&offset=21",
    "status=active&offset=-20",
    "status=active&offset=10020",
    `status=active&offset=0&search=${"x".repeat(101)}`,
  ])("rejects invalid input before data-client construction: %s", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("skips the committee lookup for empty search and makes one Users read", async () => {
    const mock = dataClient();
    mocks.createClient.mockResolvedValue(mock.client);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mock.from).not.toHaveBeenCalled();
    expect(mocks.listUsersPage).toHaveBeenCalledTimes(1);
    expect(mocks.listUsersPage).toHaveBeenCalledWith(mock.client, {
      committees: [],
      offset: 0,
      search: "",
      status: "active",
    });
  });

  it("checks the committee lookup and passes it to one Users read", async () => {
    const mock = dataClient();
    mocks.createClient.mockResolvedValue(mock.client);
    const response = await GET(
      request("status=deactivated&offset=20&search=%20CiA%20"),
    );
    expect(response.status).toBe(200);
    expect(mock.from).toHaveBeenCalledWith("committees");
    expect(mock.select).toHaveBeenCalledWith("id, name");
    expect(mock.order).toHaveBeenCalledWith("name");
    expect(mocks.listUsersPage).toHaveBeenCalledTimes(1);
    expect(mocks.listUsersPage).toHaveBeenCalledWith(mock.client, {
      committees: [committee],
      offset: 20,
      search: "CiA",
      status: "deactivated",
    });
  });

  it("fails safely when the committee lookup fails or has invalid rows", async () => {
    for (const result of [
      { data: null, error: { message: "private" } },
      { data: [{ id: 7, name: "CIA" }], error: null },
    ]) {
      const mock = dataClient(result);
      mocks.createClient.mockResolvedValue(mock.client);
      const response = await GET(
        request("status=active&offset=0&search=cia"),
      );
      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({
        error: "Users could not be loaded",
      });
    }
    expect(mocks.listUsersPage).not.toHaveBeenCalled();
  });

  it("fails safely when the Users query reports or throws an error", async () => {
    const mock = dataClient();
    mocks.createClient.mockResolvedValue(mock.client);
    mocks.listUsersPage.mockResolvedValueOnce({
      data: [],
      error: { message: "private" },
    });
    expect((await GET(request())).status).toBe(500);
    mocks.listUsersPage.mockRejectedValueOnce(new Error("invalid committee id"));
    expect((await GET(request())).status).toBe(500);
  });
});

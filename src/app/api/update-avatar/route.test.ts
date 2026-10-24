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

const activeMember = {
  role: "Member",
  committee_id: "committee-1",
  is_active: true,
};

function request(body: unknown) {
  return new Request("http://localhost/api/update-avatar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function clients(options?: {
  objects?: Array<{
    name: string;
    updated_at?: string | null;
    created_at?: string | null;
  }> | null;
  listError?: { message: string } | null;
  profileError?: { message: string } | null;
  removeError?: { message: string } | null;
}) {
  const list = vi.fn().mockResolvedValue({
    data:
      options?.objects === undefined
        ? [{ name: "avatar.webp", updated_at: "2026-10-24T12:34:56.000Z" }]
        : options.objects,
    error: options?.listError ?? null,
  });
  const remove = vi.fn().mockResolvedValue({ error: options?.removeError ?? null });
  const getPublicUrl = vi.fn(() => ({
    data: { publicUrl: "https://storage.example/user-1/avatar.webp" },
  }));
  const storageFrom = vi.fn(() => ({ list, remove, getPublicUrl }));

  const eq = vi.fn().mockResolvedValue({ error: options?.profileError ?? null });
  const update = vi.fn(() => ({ eq }));
  const databaseFrom = vi.fn(() => ({ update }));

  return {
    caller: { storage: { from: storageFrom } },
    admin: { from: databaseFrom },
    list,
    remove,
    getPublicUrl,
    update,
    eq,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "user-1" });
  mocks.getActiveProfileForRoles.mockResolvedValue(activeMember);
});

describe("POST /api/update-avatar authorization", () => {
  it("denies signed-out callers before profile or service-role access", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const response = await POST(request({ action: "save" }));

    expect(response.status).toBe(401);
    expect(mocks.getActiveProfileForRoles).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  for (const caller of ["inactive", "profile-less"]) {
    it(`denies ${caller} callers before service-role access`, async () => {
      mocks.getActiveProfileForRoles.mockResolvedValue(null);
      const response = await POST(request({ action: "save" }));

      expect(response.status).toBe(403);
      expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith([
        "Admin",
        "Co-Admin",
        "Member",
      ]);
      expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
    });
  }
});

describe("POST /api/update-avatar writes", () => {
  it("ignores client URL/version and stores the server-derived versioned URL", async () => {
    const mock = clients();
    mocks.createClient.mockResolvedValue(mock.caller);
    mocks.createServiceRoleClient.mockResolvedValue(mock.admin);

    const response = await POST(
      request({
        action: "save",
        avatarUrl: "https://evil.invalid/avatar.webp?v=forged",
        version: "forged",
      }),
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(mock.list).toHaveBeenCalledWith("user-1", {
      limit: 100,
      search: "avatar.webp",
    });
    expect(mock.getPublicUrl).toHaveBeenCalledWith("user-1/avatar.webp");
    expect(new URL(data.avatarUrl).searchParams.get("v")).toBe(
      "2026-10-24T12:34:56.000Z",
    );
    expect(data.avatarUrl).not.toContain("evil.invalid");
    expect(mock.update).toHaveBeenCalledWith({ avatar_url: data.avatarUrl });
    expect(mock.eq).toHaveBeenCalledWith("id", "user-1");
  });

  it("returns a checked safe error when the fixed object is missing", async () => {
    const mock = clients({ objects: [] });
    mocks.createClient.mockResolvedValue(mock.caller);
    mocks.createServiceRoleClient.mockResolvedValue(mock.admin);

    const response = await POST(request({ action: "save" }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Uploaded photo was not found",
    });
    expect(mock.update).not.toHaveBeenCalled();
  });

  it("clears the database before Storage and returns a retry-safe warning", async () => {
    const mock = clients({ removeError: { message: "storage unavailable" } });
    mocks.createClient.mockResolvedValue(mock.caller);
    mocks.createServiceRoleClient.mockResolvedValue(mock.admin);

    const response = await POST(request({ action: "remove" }));

    expect(response.status).toBe(200);
    expect(mock.update).toHaveBeenCalledWith({ avatar_url: null });
    expect(mock.update.mock.invocationCallOrder[0]).toBeLessThan(
      mock.remove.mock.invocationCallOrder[0],
    );
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      avatarUrl: null,
      cleanupPending: true,
    });

    const retry = await POST(request({ action: "remove" }));
    expect(retry.status).toBe(200);
    expect(mock.update).toHaveBeenCalledTimes(2);
    expect(mock.remove).toHaveBeenCalledTimes(2);
  });

  it("does not delete Storage when clearing the database fails", async () => {
    const mock = clients({ profileError: { message: "database unavailable" } });
    mocks.createClient.mockResolvedValue(mock.caller);
    mocks.createServiceRoleClient.mockResolvedValue(mock.admin);

    const response = await POST(request({ action: "remove" }));

    expect(response.status).toBe(500);
    expect(mock.remove).not.toHaveBeenCalled();
  });
});

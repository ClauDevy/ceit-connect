import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: mocks.createServiceRoleClient,
}));

import { POST } from "./route";

const activeAdmin = { role: "Admin", committee_id: null, is_active: true };

function request(body: unknown = {}) {
  return new Request("http://localhost/api/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    email: "  New.Member@Example.edu ",
    fullName: "  New Member  ",
    role: "Member",
    committeeId: "committee-1",
  };
}

function adminClient(options?: {
  inviteError?: { message: string } | null;
  profileError?: { message: string } | null;
  rollbackError?: { message: string } | null;
}) {
  const insert = vi.fn().mockResolvedValue({
    error: options?.profileError ?? null,
  });
  const deleteUser = vi.fn().mockResolvedValue({
    error: options?.rollbackError ?? null,
  });
  const inviteUserByEmail = vi.fn().mockResolvedValue({
    data: { user: options?.inviteError ? null : { id: "new-user" } },
    error: options?.inviteError ?? null,
  });
  return {
    client: {
      auth: { admin: { inviteUserByEmail, deleteUser } },
      from: vi.fn(() => ({ insert })),
    },
    deleteUser,
    insert,
    inviteUserByEmail,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "admin" });
  mocks.getActiveProfileForRoles.mockResolvedValue(activeAdmin);
  process.env.ALLOWED_EMAIL_DOMAINS = "example.edu";
});

describe("POST /api/invite authorization", () => {
  it("returns JSON 401 for a signed-out caller before the active-profile guard", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const response = await POST(request(validBody()));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Not signed in" });
    expect(mocks.getActiveProfileForRoles).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  for (const caller of ["inactive Admin", "profile-less", "Co-Admin", "Member"]) {
    it(`returns JSON 403 for ${caller} before service-role construction`, async () => {
      mocks.getActiveProfileForRoles.mockResolvedValue(null);
      const response = await POST(request(validBody()));
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Only active Admins can invite members",
      });
      expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith(["Admin"]);
      expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
    });
  }
});

describe("POST /api/invite validation and writes", () => {
  it("rejects malformed JSON and wrong runtime field types before service role", async () => {
    const malformed = new Request("http://localhost/api/invite", {
      method: "POST",
      body: "{",
    });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request({ ...validBody(), fullName: 7 }))).status).toBe(
      400,
    );
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("keeps active Admin invite success and normalizes stored fields", async () => {
    const mock = adminClient();
    mocks.createServiceRoleClient.mockResolvedValue(mock.client);
    const response = await POST(request(validBody()));
    expect(response.status).toBe(200);
    expect(mock.inviteUserByEmail).toHaveBeenCalledWith(
      "new.member@example.edu",
      { redirectTo: "http://localhost/auth/callback" },
    );
    expect(mock.insert).toHaveBeenCalledWith({
      id: "new-user",
      email: "new.member@example.edu",
      full_name: "New Member",
      role: "Member",
      committee_id: "committee-1",
    });
  });

  it("checks an Auth invite failure", async () => {
    const mock = adminClient({ inviteError: { message: "invite failed" } });
    mocks.createServiceRoleClient.mockResolvedValue(mock.client);
    const response = await POST(request(validBody()));
    expect(response.status).toBe(500);
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it("rolls back a failed profile insert and checks rollback failure", async () => {
    const mock = adminClient({
      profileError: { message: "profile failed" },
      rollbackError: { message: "rollback failed" },
    });
    mocks.createServiceRoleClient.mockResolvedValue(mock.client);
    const response = await POST(request(validBody()));
    expect(response.status).toBe(500);
    expect(mock.deleteUser).toHaveBeenCalledWith("new-user");
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create profile and roll back the invitation",
    });
  });
});

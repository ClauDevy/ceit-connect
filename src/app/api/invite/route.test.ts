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

const committeeId = "20000000-0000-4000-8000-000000000001";
const authUserId = "10000000-0000-4000-8000-000000000001";
const activeAdmin = { role: "Admin", committee_id: null, is_active: true };
const activeCoAdmin = {
  role: "Co-Admin",
  committee_id: committeeId,
  is_active: true,
};

function request(body: unknown = adminBody()) {
  return new Request("http://localhost/api/invite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function adminBody() {
  return {
    email: "  New.Member@Example.edu ",
    fullName: "  New Member  ",
    committeeId,
  };
}

function callerClient(finalizeError: unknown = null, committeeExists = true) {
  const rpc = vi.fn().mockResolvedValue({ data: authUserId, error: finalizeError });
  const maybeSingle = vi.fn().mockResolvedValue({
    data: committeeExists ? { id: committeeId } : null,
    error: null,
  });
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const client = { rpc, from };
  mocks.createClient.mockResolvedValue(client);
  return { client, rpc, from };
}

function adminClient(options?: {
  inviteError?: unknown;
  profile?: boolean;
  officerById?: boolean;
  officerByEmail?: boolean;
  precheckOfficerByEmail?: boolean;
  precheckError?: boolean;
  confirmed?: boolean;
  signedIn?: boolean;
  cleanupReadError?: boolean;
  deleteError?: unknown;
}) {
  const inviteUserByEmail = vi.fn().mockResolvedValue({
    data: { user: options?.inviteError ? null : { id: authUserId } },
    error: options?.inviteError ?? null,
  });
  const getUserById = vi.fn().mockResolvedValue({
    data: {
      user: {
        id: authUserId,
        email_confirmed_at: options?.confirmed ? "2026-01-01" : null,
        last_sign_in_at: options?.signedIn ? "2026-01-01" : null,
      },
    },
    error: options?.cleanupReadError ? { message: "private" } : null,
  });
  const deleteUser = vi.fn().mockResolvedValue({
    data: {},
    error: options?.deleteError ?? null,
  });
  let officerEmailQuery = 0;
  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn((column: string) =>
        table === "users"
          ? {
              maybeSingle: vi.fn().mockResolvedValue({
                data: options?.profile ? { id: authUserId } : null,
                error: options?.cleanupReadError ? { message: "private" } : null,
              }),
            }
          : {
              in: vi.fn(() => ({
                limit: vi.fn(() => {
                  if (column === "email" && officerEmailQuery++ === 0) {
                    return Promise.resolve({
                      data: options?.precheckOfficerByEmail
                        ? [{ id: "invite" }]
                        : [],
                      error: options?.precheckError
                        ? { message: "private" }
                        : null,
                    });
                  }
                  return Promise.resolve({
                    data:
                      (column === "auth_user_id"
                        ? options?.officerById
                        : options?.officerByEmail)
                        ? [{ id: "invite" }]
                        : [],
                    error: options?.cleanupReadError
                      ? { message: "private" }
                      : null,
                  });
                }),
              })),
            },
      ),
    })),
  }));
  const client = {
    auth: { admin: { inviteUserByEmail, getUserById, deleteUser } },
    from,
  };
  mocks.createServiceRoleClient.mockResolvedValue(client);
  return { client, inviteUserByEmail, getUserById, deleteUser, from };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "caller" });
  mocks.getActiveProfileForRoles.mockResolvedValue(activeAdmin);
  process.env.ALLOWED_EMAIL_DOMAINS = "example.edu";
  callerClient();
});

describe("POST /api/invite authorization and authority", () => {
  it("rejects signed-out and inactive callers before service-role construction", async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(401);
    mocks.getAuthUser.mockResolvedValue({ id: "caller" });
    mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects client role authority for both callers", async () => {
    expect((await POST(request({ ...adminBody(), role: "Member" }))).status).toBe(400);
    mocks.getActiveProfileForRoles.mockResolvedValue(activeCoAdmin);
    expect(
      (await POST(request({ email: "a@example.edu", fullName: "A", role: "Member" }))).status,
    ).toBe(400);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects committee authority from a Co-Admin, including their own committee", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValue(activeCoAdmin);
    const response = await POST(
      request({ email: "a@example.edu", fullName: "A", committeeId }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("requires a real committee for Admin before sending Auth email", async () => {
    callerClient(null, false);
    const response = await POST(request());
    expect(response.status).toBe(400);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });
});

describe("POST /api/invite finalization and cleanup", () => {
  it("finalizes an Admin invite with the selected committee", async () => {
    const caller = callerClient();
    const service = adminClient();
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(service.inviteUserByEmail).toHaveBeenCalledWith(
      "new.member@example.edu",
      { redirectTo: "http://localhost/auth/callback" },
    );
    expect(caller.rpc).toHaveBeenCalledWith("finalize_member_invite", {
      p_auth_user_id: authUserId,
      p_email: "new.member@example.edu",
      p_full_name: "New Member",
      p_committee_id: committeeId,
    });
  });

  it("finalizes a Co-Admin invite with no client committee authority", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValue(activeCoAdmin);
    const caller = callerClient();
    adminClient();
    const response = await POST(
      request({ email: "new.member@example.edu", fullName: "New Member" }),
    );
    expect(response.status).toBe(200);
    expect(caller.from).not.toHaveBeenCalled();
    expect(caller.rpc).toHaveBeenCalledWith(
      "finalize_member_invite",
      expect.objectContaining({ p_committee_id: null }),
    );
  });

  it("keeps the Batch 8 Auth email rate-limit mapping", async () => {
    adminClient({
      inviteError: { status: 429, code: "over_email_send_rate_limit" },
    });
    const response = await POST(request());
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: "Email limit reached. Try again in about an hour.",
    });
  });

  it("maps an already-registered Auth email to the safe CCM07 conflict", async () => {
    const caller = callerClient();
    const service = adminClient({
      inviteError: { status: 422, code: "email_exists", message: "private" },
    });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An account or officer invitation already uses this email.",
    });
    expect(service.getUserById).not.toHaveBeenCalled();
    expect(service.deleteUser).not.toHaveBeenCalled();
    expect(caller.rpc).not.toHaveBeenCalled();
  });

  it("keeps unrelated Auth invite failures generic", async () => {
    const caller = callerClient();
    const service = adminClient({
      inviteError: { status: 503, code: "unexpected_failure", message: "private" },
    });
    const response = await POST(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The invitation email could not be sent. Try again.",
    });
    expect(service.getUserById).not.toHaveBeenCalled();
    expect(service.deleteUser).not.toHaveBeenCalled();
    expect(caller.rpc).not.toHaveBeenCalled();
  });

  it("rejects an email owned by a live officer invite before sending Auth email", async () => {
    const service = adminClient({ precheckOfficerByEmail: true });
    const response = await POST(request());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "An account or officer invitation already uses this email.",
    });
    expect(service.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("fails closed when the officer-invite pre-check errors", async () => {
    const service = adminClient({ precheckError: true });
    const response = await POST(request());
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "The invitation could not be completed. Try again.",
    });
    expect(service.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("does not delete when CCM07 reports a live officer invitation collision", async () => {
    callerClient({ code: "CCM07", message: "private" });
    const service = adminClient();
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(service.getUserById).not.toHaveBeenCalled();
    expect(service.deleteUser).not.toHaveBeenCalled();
  });

  it("does not delete when finalization returns CCM06", async () => {
    callerClient({ code: "CCM06", message: "private" });
    const service = adminClient();
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(service.getUserById).not.toHaveBeenCalled();
    expect(service.deleteUser).not.toHaveBeenCalled();
  });

  it.each([
    ["confirmed", { confirmed: true }],
    ["signed in", { signedIn: true }],
  ])("does not delete when the cleanup re-check finds an Auth user that is %s", async (_label, state) => {
    callerClient({ code: "CCM09", message: "private" });
    const service = adminClient(state);
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(service.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes only after every Auth, profile, and officer-invite cleanup check passes", async () => {
    callerClient({ code: "CCM09", message: "private" });
    const service = adminClient();
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(service.getUserById).toHaveBeenCalledWith(authUserId);
    expect(service.from).toHaveBeenCalledWith("users");
    expect(service.from).toHaveBeenCalledWith("officer_invites");
    expect(service.deleteUser).toHaveBeenCalledWith(authUserId);
  });

  it("does not delete when any cleanup re-check errors", async () => {
    callerClient({ code: "CCM09", message: "private" });
    const service = adminClient({ cleanupReadError: true });
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(service.deleteUser).not.toHaveBeenCalled();
  });
});

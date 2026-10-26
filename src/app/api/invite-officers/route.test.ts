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

const committeeId = "10000000-0000-4000-8000-000000000001";
const inviteId = "20000000-0000-4000-8000-000000000001";
const authUserId = "30000000-0000-4000-8000-000000000001";

function row(index = 1) {
  return {
    clientId: `row-${index}`,
    inviteId: null,
    email: `officer${index}@example.edu`,
    fullName: `Officer ${index}`,
    role: "Co-Admin",
    committeeId,
  };
}

function request(body: unknown) {
  return new Request("http://localhost/api/invite-officers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function clients(options?: {
  rpc?: ReturnType<typeof vi.fn>;
  invite?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
  remove?: ReturnType<typeof vi.fn>;
}) {
  const rpc = options?.rpc ?? vi.fn();
  const inviteUserByEmail =
    options?.invite ??
    vi.fn().mockResolvedValue({ data: { user: { id: authUserId } }, error: null });
  const updateUserById =
    options?.update ?? vi.fn().mockResolvedValue({ data: {}, error: null });
  const deleteUser =
    options?.remove ?? vi.fn().mockResolvedValue({ data: {}, error: null });
  mocks.createClient.mockResolvedValue({ rpc });
  mocks.createServiceRoleClient.mockResolvedValue({
    auth: { admin: { inviteUserByEmail, updateUserById, deleteUser } },
  });
  return { rpc, inviteUserByEmail, updateUserById, deleteUser };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: "admin" });
  mocks.getActiveProfileForRoles.mockResolvedValue({ role: "Admin", is_active: true });
  process.env.ALLOWED_EMAIL_DOMAINS = "example.edu";
});

describe("POST /api/invite-officers", () => {
  it("denies signed-out and inactive callers before service-role construction", async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect((await POST(request({ action: "send", invites: [row()] }))).status).toBe(401);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();

    mocks.getAuthUser.mockResolvedValue({ id: "admin" });
    mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
    expect((await POST(request({ action: "send", invites: [row()] }))).status).toBe(403);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each([0, 11])("rejects a batch of %s before service-role construction", async (count) => {
    clients();
    const response = await POST(
      request({ action: "send", invites: Array.from({ length: count }, (_, i) => row(i)) }),
    );
    expect(response.status).toBe(400);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each([1, 10])("accepts a valid batch of %s", async (count) => {
    const ids = Array.from({ length: count }, (_, index) =>
      `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000001`,
    );
    let prepare = 0;
    const mock = clients({
      rpc: vi.fn(async (name: string, args: { p_auth_user_id?: string | null }) => {
        if (name === "invite_new_officer" && args.p_auth_user_id === null) {
          return { data: { outcome: "prepared", invite_id: ids[prepare++] }, error: null };
        }
        return { data: { outcome: "sent" }, error: null };
      }),
    });
    const response = await POST(
      request({ action: "send", invites: Array.from({ length: count }, (_, i) => row(i + 1)) }),
    );
    expect(response.status).toBe(200);
    expect(mock.inviteUserByEmail).toHaveBeenCalledTimes(count);
  });

  it("fails closed when ALLOWED_EMAIL_DOMAINS is missing or empty", async () => {
    clients();
    for (const value of [undefined, " , "]) {
      if (value === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
      else process.env.ALLOWED_EMAIL_DOMAINS = value;
      const response = await POST(request({ action: "send", invites: [row()] }));
      expect(response.status).toBe(503);
    }
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects normalized duplicates before any RPC or Auth work", async () => {
    const mock = clients();
    const duplicate = { ...row(2), email: " OFFICER1@EXAMPLE.EDU " };
    const response = await POST(request({ action: "send", invites: [row(), duplicate] }));
    expect(response.status).toBe(400);
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("runs prepare, Auth send, and finalize sequentially", async () => {
    const calls: string[] = [];
    const mock = clients({
      rpc: vi.fn(async (_name: string, args: { p_auth_user_id?: string | null }) => {
        calls.push(args.p_auth_user_id === null ? "prepare" : "finalize");
        return {
          data:
            args.p_auth_user_id === null
              ? { outcome: "prepared", invite_id: inviteId }
              : { outcome: "sent" },
          error: null,
        };
      }),
      invite: vi.fn(async () => {
        calls.push("send");
        return { data: { user: { id: authUserId } }, error: null };
      }),
    });
    const response = await POST(request({ action: "send", invites: [row()] }));
    expect(response.status).toBe(200);
    expect(calls).toEqual(["prepare", "send", "finalize"]);
    expect(mock.inviteUserByEmail).toHaveBeenCalledWith("officer1@example.edu", {
      redirectTo: "http://localhost/auth/callback",
    });
  });

  it.each([
    ["sent", "sent"],
    ["preparing", "unsent"],
    ["cleanup_pending", "cleanup-pending"],
    ["cancelled", "failed"],
  ])("maps the %s RPC outcome without sending", async (outcome, state) => {
    const mock = clients({
      rpc: vi.fn().mockResolvedValue({
        data: { outcome, invite_id: inviteId },
        error: null,
      }),
    });
    const response = await POST(request({ action: "send", invites: [row()] }));
    const body = await response.json();
    expect(body.results[0].state).toBe(state);
    expect(mock.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("always cancels after an invite error and deletes a user created before email failure", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { outcome: "prepared", invite_id: inviteId }, error: null })
      .mockResolvedValueOnce({
        data: {
          outcome: "cancelled",
          cleanup_action: "delete_new_attempt",
          auth_user_id: authUserId,
        },
        error: null,
      });
    const mock = clients({
      rpc,
      invite: vi.fn().mockResolvedValue({
        data: { user: { id: authUserId } },
        error: { status: 500, code: "unexpected_failure", message: "private" },
      }),
    });
    const response = await POST(request({ action: "send", invites: [row()] }));
    const body = await response.json();
    expect(rpc.mock.calls[1][0]).toBe("cancel_officer_invite");
    expect(mock.deleteUser).toHaveBeenCalledWith(authUserId);
    expect(body.results[0]).toMatchObject({
      state: "failed",
      inviteId,
      authUserId,
    });
    expect(JSON.stringify(body)).not.toContain("private");
  });

  it("stops on the installed 429 email-rate-limit shape and preserves prior results", async () => {
    let preparation = 0;
    const ids = [inviteId, "20000000-0000-4000-8000-000000000002"];
    const rpc = vi.fn(async (name: string, args: { p_auth_user_id?: string | null }) => {
      if (name === "cancel_officer_invite") {
        return {
          data: {
            outcome: "cancelled",
            cleanup_action: "delete_new_attempt",
            auth_user_id: authUserId,
          },
          error: null,
        };
      }
      if (args.p_auth_user_id === null) {
        return { data: { outcome: "prepared", invite_id: ids[preparation++] }, error: null };
      }
      return { data: { outcome: "sent" }, error: null };
    });
    let sends = 0;
    const mock = clients({
      rpc,
      invite: vi.fn(async () => {
        sends += 1;
        return sends === 1
          ? { data: { user: { id: authUserId } }, error: null }
          : {
              data: { user: null },
              error: {
                status: 429,
                code: "over_email_send_rate_limit",
                message: "do not match this text",
              },
            };
      }),
    });
    const response = await POST(
      request({ action: "send", invites: [row(1), row(2), row(3)] }),
    );
    const body = await response.json();
    expect(mock.inviteUserByEmail).toHaveBeenCalledTimes(2);
    expect(body.notice).toBe("Email limit reached. Try again in about an hour.");
    expect(body.results.map((item: { state: string }) => item.state)).toEqual([
      "sent",
      "unsent",
      "unsent",
    ]);
    expect(body.results[1]).toMatchObject({
      inviteId: null,
      authUserId,
    });
    expect(body.results[1].inviteId).not.toBe(ids[1]);
    expect(mock.deleteUser).toHaveBeenCalledWith(authUserId);
  });

  it("stops before later entries when the first send is rate limited", async () => {
    const mock = clients({
      rpc: vi.fn(async (name: string) =>
        name === "cancel_officer_invite"
          ? { data: { outcome: "cancelled", cleanup_action: "none" }, error: null }
          : { data: { outcome: "prepared", invite_id: inviteId }, error: null },
      ),
      invite: vi.fn().mockResolvedValue({
        data: { user: null },
        error: { status: 429, code: "over_email_send_rate_limit", message: "ignored" },
      }),
    });
    const response = await POST(
      request({ action: "send", invites: [row(1), row(2), row(3)] }),
    );
    const body = await response.json();
    expect(mock.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(body.results.map((item: { state: string }) => item.state)).toEqual([
      "unsent",
      "unsent",
      "unsent",
    ]);
    expect(body.results[0]).toMatchObject({ inviteId: null });
    expect(body.results[0].inviteId).not.toBe(inviteId);
    expect(body.results[0].authUserId).toBeUndefined();
    expect(mock.deleteUser).not.toHaveBeenCalled();
    expect(mock.updateUserById).not.toHaveBeenCalled();
  });

  it("keeps the authoritative invite id when rate-limit cleanup is pending", async () => {
    const mock = clients({
      rpc: vi
        .fn()
        .mockResolvedValueOnce({
          data: { outcome: "prepared", invite_id: inviteId },
          error: null,
        })
        .mockResolvedValueOnce({
          data: null,
          error: { code: "CCO06", message: "private" },
        }),
      invite: vi.fn().mockResolvedValue({
        data: { user: { id: authUserId } },
        error: {
          status: 429,
          code: "over_email_send_rate_limit",
          message: "ignored",
        },
      }),
    });
    const response = await POST(
      request({ action: "send", invites: [row(1), row(2)] }),
    );
    const body = await response.json();
    expect(mock.inviteUserByEmail).toHaveBeenCalledTimes(1);
    expect(body.results[0]).toMatchObject({
      state: "cleanup-pending",
      inviteId,
      authUserId,
    });
    expect(body.results[1]).toMatchObject({ state: "unsent", inviteId: null });
    expect(JSON.stringify(body)).not.toContain("private");
  });

  it("does not duplicate a send when explicit retry re-reads sent", async () => {
    const mock = clients({
      rpc: vi.fn().mockResolvedValue({
        data: { outcome: "sent", invite_id: inviteId },
        error: null,
      }),
    });
    const retryRow = { ...row(), inviteId };
    const response = await POST(
      request({ action: "retry", invites: [retryRow] }),
    );
    const body = await response.json();
    expect(body.results[0].state).toBe("sent");
    expect(mock.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it("deletes a never-finalized Auth attempt after finalization fails", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: { outcome: "prepared", invite_id: inviteId }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "CCO06", message: "private" } })
      .mockResolvedValueOnce({
        data: {
          outcome: "cancelled",
          cleanup_action: "delete_new_attempt",
          auth_user_id: authUserId,
        },
        error: null,
      });
    const mock = clients({ rpc });
    const response = await POST(request({ action: "send", invites: [row()] }));
    const body = await response.json();
    expect(mock.deleteUser).toHaveBeenCalledWith(authUserId);
    expect(body.results[0].state).toBe("failed");
  });

  it("runs the idempotent cancel RPC before banning and reports failed ban cleanup", async () => {
    const order: string[] = [];
    const mock = clients({
      rpc: vi.fn(async () => {
        order.push("cancel");
        return {
          data: {
            outcome: "cancelled",
            cleanup_action: "revoke",
            auth_user_id: authUserId,
          },
          error: null,
        };
      }),
      update: vi.fn(async () => {
        order.push("ban");
        return { data: null, error: { message: "private" } };
      }),
    });
    const response = await POST(request({ action: "cancel", inviteId }));
    const body = await response.json();
    expect(order).toEqual(["cancel", "ban"]);
    expect(mock.updateUserById).toHaveBeenCalledWith(authUserId, {
      ban_duration: "876000h",
    });
    expect(response.status).toBe(502);
    expect(body).toMatchObject({ state: "cleanup-pending", authUserId });
    expect(JSON.stringify(body)).not.toContain("private");
  });
});

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

import { maxDuration, POST } from "./route";

const adminId = "10000000-0000-4000-8000-000000000001";
const targetId = "10000000-0000-4000-8000-000000000002";
const secondId = "10000000-0000-4000-8000-000000000003";
const timestamp = "2026-10-27T12:00:00.000Z";

function request(body: unknown) {
  return new Request("http://localhost/api/remove-former-members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function previewRows(userIds: string[]) {
  return userIds.map((userId, index) => ({
    input_ordinal: index + 1,
    user_id: userId,
    full_name: `Member ${index + 1}`,
    email: `member${index + 1}@example.com`,
    role: "Member",
    committee_id: null,
    is_active: false,
    anonymized_at: null,
    open_task_count: 0,
    outcome: "eligible",
    reason_code: "eligible",
  }));
}

function anonymizedRow(userId: string, outcome = "anonymized") {
  return [
    {
      out_user_id: userId,
      out_outcome: outcome,
      out_reason_code:
        outcome === "already_anonymized" ? "already_anonymized" : "anonymized",
      out_email: `${userId}@former.invalid`,
      out_anonymized_at: timestamp,
    },
  ];
}

function callerClient(
  implementation?: (name: string, args: Record<string, unknown>) => unknown,
) {
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (implementation) return implementation(name, args);
    if (name === "preview_former_member_removal") {
      return { data: previewRows(args.p_user_ids as string[]), error: null };
    }
    return { data: anonymizedRow(args.p_user_id as string), error: null };
  });
  const client = { rpc };
  mocks.createClient.mockResolvedValue(client);
  return { client, rpc };
}

function serviceClient(options?: {
  authError?: unknown;
  storageError?: unknown;
  throwAuth?: boolean;
  throwStorage?: boolean;
  invalidAuthState?: boolean;
  cleanupError?: unknown;
  throwCleanup?: boolean;
  invalidCleanupState?: boolean;
}) {
  const updateUserById = vi.fn(async (userId: string, attributes: object) => {
    if (options?.throwAuth) throw new Error("auth down");
    return {
      data: {
        user: {
          id: userId,
          email: `${userId}@former.invalid`,
          email_confirmed_at: timestamp,
          banned_until: options?.invalidAuthState
            ? null
            : "2126-10-27T12:00:00.000Z",
        },
      },
      error: options?.authError ?? null,
      attributes,
    };
  });
  const remove = vi.fn(async () => {
    if (options?.throwStorage) throw new Error("storage down");
    return { data: [], error: options?.storageError ?? null };
  });
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (options?.throwCleanup) throw new Error("cleanup down");
    return {
      data: options?.invalidCleanupState
        ? [{ out_user_id: args.p_user_id, out_outcome: "partial" }]
        : [
            {
              out_user_id: args.p_user_id,
              out_outcome: "cleaned",
              out_email_identity_count: 1,
            },
          ],
      error: options?.cleanupError ?? null,
      name,
    };
  });
  const client = {
    auth: { admin: { updateUserById } },
    rpc,
    storage: { from: vi.fn(() => ({ remove })) },
  };
  mocks.createServiceRoleClient.mockResolvedValue(client);
  return { client, updateUserById, rpc, remove };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthUser.mockResolvedValue({ id: adminId });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Admin",
    committee_id: null,
    is_active: true,
  });
  callerClient();
  serviceClient();
});

describe("POST /api/remove-former-members authorization and preview", () => {
  it("uses a conservative 60-second deployment hint", () => {
    expect(maxDuration).toBe(60);
  });

  it("rejects signed-out and non-Admin callers before caller or service clients", async () => {
    mocks.getAuthUser.mockResolvedValueOnce(null);
    expect(
      (await POST(request({ action: "preview", userIds: [targetId] }))).status,
    ).toBe(401);
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();

    mocks.getAuthUser.mockResolvedValue({ id: adminId });
    mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
    expect(
      (await POST(request({ action: "preview", userIds: [targetId] }))).status,
    ).toBe(403);
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("rejects malformed, duplicate, and 51-row requests", async () => {
    const fiftyOne = Array.from(
      { length: 51 },
      (_, index) =>
        `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    for (const body of [
      { action: "preview", userIds: [] },
      { action: "preview", userIds: [targetId, targetId] },
      { action: "preview", userIds: fiftyOne },
      { action: "preview", userIds: [targetId], role: "Admin" },
    ]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("returns an ordered authoritative no-store preview", async () => {
    const session = callerClient();
    const response = await POST(
      request({ action: "preview", userIds: [targetId, secondId] }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      count: 2,
      users: [
        { inputOrdinal: 1, userId: targetId, outcome: "eligible" },
        { inputOrdinal: 2, userId: secondId, outcome: "eligible" },
      ],
    });
    expect(session.rpc).toHaveBeenCalledWith("preview_former_member_removal", {
      p_user_ids: [targetId, secondId],
    });
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it("fails closed on malformed RPC data and never exposes raw errors", async () => {
    callerClient((name) =>
      name === "preview_former_member_removal"
        ? { data: [{ private: "bad" }], error: null }
        : { data: null, error: null },
    );
    const response = await POST(
      request({ action: "preview", userIds: [targetId] }),
    );
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("private");
  });
});

describe("POST /api/remove-former-members execution", () => {
  it("reruns preview and requires the exact authoritative confirmation", async () => {
    const session = callerClient();
    const response = await POST(
      request({
        action: "remove",
        userIds: [targetId],
        confirmation: "REMOVE 1 MEMBER",
      }),
    );
    expect(response.status).toBe(400);
    expect(session.rpc).toHaveBeenCalledTimes(1);
    expect(session.rpc).toHaveBeenCalledWith("preview_former_member_removal", {
      p_user_ids: [targetId],
    });
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each(["anonymized", "already_anonymized"])(
    "completes Auth, identity, and Storage cleanup for the %s DB outcome",
    async (outcome) => {
      const session = callerClient((name, args) =>
        name === "preview_former_member_removal"
          ? { data: previewRows(args.p_user_ids as string[]), error: null }
          : {
              data: anonymizedRow(args.p_user_id as string, outcome),
              error: null,
            },
      );
      const service = serviceClient();
      const response = await POST(
        request({
          action: "remove",
          userIds: [targetId],
          confirmation: "REMOVE 1 MEMBERS",
        }),
      );
      expect(await response.json()).toEqual({
        results: [
          {
            userId: targetId,
            state: "removed",
            message: "Former-member removal completed.",
          },
        ],
      });
      expect(session.rpc).toHaveBeenLastCalledWith("anonymize_former_member", {
        p_user_id: targetId,
      });
      expect(service.updateUserById).toHaveBeenCalledWith(targetId, {
        email: `${targetId}@former.invalid`,
        email_confirm: true,
        ban_duration: "876000h",
      });
      expect(service.updateUserById.mock.calls[0]?.[1]).not.toHaveProperty(
        "user_metadata",
      );
      expect(service.rpc).toHaveBeenCalledWith("cleanup_former_member_auth", {
        p_user_id: targetId,
      });
      expect(service.remove).toHaveBeenCalledWith([`${targetId}/avatar.webp`]);
      expect(service.updateUserById.mock.invocationCallOrder[0]).toBeLessThan(
        service.rpc.mock.invocationCallOrder[0] ?? 0,
      );
      expect(service.rpc.mock.invocationCallOrder[0]).toBeLessThan(
        service.remove.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );

  it("returns skipped without constructing a service client", async () => {
    callerClient((name, args) =>
      name === "preview_former_member_removal"
        ? { data: previewRows(args.p_user_ids as string[]), error: null }
        : {
            data: [
              {
                out_user_id: targetId,
                out_outcome: "skipped",
                out_reason_code: "open_tasks",
                out_email: "member@example.com",
                out_anonymized_at: null,
              },
            ],
            error: null,
          },
    );
    const response = await POST(
      request({
        action: "remove",
        userIds: [targetId],
        confirmation: "REMOVE 1 MEMBERS",
      }),
    );
    expect((await response.json()).results[0]).toMatchObject({
      state: "skipped",
      reasonCode: "open_tasks",
    });
    expect(mocks.createServiceRoleClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ authError: { message: "private" } }, "failed"],
    [{ throwAuth: true }, "failed"],
  ] as const)(
    "reports Auth failure as %s and says the email is not free",
    async (options, state) => {
      const service = serviceClient(options);
      const response = await POST(
        request({
          action: "remove",
          userIds: [targetId],
          confirmation: "REMOVE 1 MEMBERS",
        }),
      );
      const result = (await response.json()).results[0];
      expect(result.state).toBe(state);
      expect(result.message).toContain("original email is not free yet");
      expect(result.message).not.toContain("private");
      expect(service.rpc).not.toHaveBeenCalled();
      expect(service.remove).not.toHaveBeenCalled();
    },
  );

  it("does not report removed when Auth returns an unverified result", async () => {
    const service = serviceClient({ invalidAuthState: true });
    const response = await POST(
      request({
        action: "remove",
        userIds: [targetId],
        confirmation: "REMOVE 1 MEMBERS",
      }),
    );
    const result = (await response.json()).results[0];
    expect(result.state).toBe("failed");
    expect(result.message).toContain("original email is not free yet");
    expect(service.rpc).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
  });

  it.each([
    [{ cleanupError: { message: "private" } }],
    [{ throwCleanup: true }],
    [{ invalidCleanupState: true }],
  ] as const)(
    "reports identity cleanup uncertainty as cleanup-pending",
    async (options) => {
      const service = serviceClient(options);
      const response = await POST(
        request({
          action: "remove",
          userIds: [targetId],
          confirmation: "REMOVE 1 MEMBERS",
        }),
      );
      const result = (await response.json()).results[0];
      expect(result.state).toBe("cleanup-pending");
      expect(result.message).toContain("original email is free for re-invite");
      expect(result.message).toContain(
        "Google sign-in for the original address may still resolve to the old banned account",
      );
      expect(result.message).toContain("Cleanup may be retried");
      expect(result.message).not.toContain("private");
      expect(service.remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    [{ storageError: { message: "private" } }],
    [{ throwStorage: true }],
  ] as const)("reports Storage failure as cleanup-pending", async (options) => {
    serviceClient(options);
    const response = await POST(
      request({
        action: "remove",
        userIds: [targetId],
        confirmation: "REMOVE 1 MEMBERS",
      }),
    );
    const result = (await response.json()).results[0];
    expect(result.state).toBe("cleanup-pending");
    expect(result.message).toContain("Cleanup may be retried");
    expect(result.message).not.toContain("private");
  });

  it("rechecks the active Admin before DB, Auth, identity, and Storage boundaries", async () => {
    const service = serviceClient();
    mocks.getActiveProfileForRoles
      .mockResolvedValueOnce({ role: "Admin", is_active: true })
      .mockResolvedValueOnce({ role: "Admin", is_active: true })
      .mockResolvedValueOnce({ role: "Admin", is_active: true })
      .mockResolvedValueOnce(null);
    const response = await POST(
      request({
        action: "remove",
        userIds: [targetId],
        confirmation: "REMOVE 1 MEMBERS",
      }),
    );
    const result = (await response.json()).results[0];
    expect(result.state).toBe("cleanup-pending");
    expect(service.updateUserById).toHaveBeenCalledOnce();
    expect(service.rpc).not.toHaveBeenCalled();
    expect(service.remove).not.toHaveBeenCalled();
    expect(mocks.getActiveProfileForRoles).toHaveBeenCalledTimes(4);
  });

  it("keeps mixed rows independent and ordered", async () => {
    const ids = [targetId, secondId];
    callerClient((name, args) => {
      if (name === "preview_former_member_removal") {
        return { data: previewRows(args.p_user_ids as string[]), error: null };
      }
      if (args.p_user_id === targetId) {
        return { data: null, error: { code: "CMR05", message: "private" } };
      }
      return { data: anonymizedRow(secondId), error: null };
    });
    const service = serviceClient();
    const response = await POST(
      request({
        action: "remove",
        userIds: ids,
        confirmation: "REMOVE 2 MEMBERS",
      }),
    );
    expect((await response.json()).results).toEqual([
      expect.objectContaining({ userId: targetId, state: "failed" }),
      expect.objectContaining({ userId: secondId, state: "removed" }),
    ]);
    expect(service.updateUserById).toHaveBeenCalledTimes(1);
    expect(service.updateUserById).toHaveBeenCalledWith(
      secondId,
      expect.any(Object),
    );
  });
});

import { describe, expect, it } from "vitest";
import {
  expectedFormerMemberConfirmation,
  parseAnonymizeRpcRow,
  parseCleanupFormerMemberAuthRpcRow,
  parseFormerMemberPreviewPayload,
  parseFormerMemberPreviewRows,
  parseFormerMemberRemovalPayload,
  parseFormerMemberRequest,
} from "./former-member-removal";

const id = "10000000-0000-4000-8000-000000000001";
const otherId = "10000000-0000-4000-8000-000000000002";
const timestamp = "2026-10-27T12:00:00.000Z";

function previewRow(overrides: Record<string, unknown> = {}) {
  return {
    input_ordinal: 1,
    user_id: id,
    full_name: "Test Member",
    email: "test@example.com",
    role: "Member",
    committee_id: null,
    is_active: false,
    anonymized_at: null,
    open_task_count: 0,
    outcome: "eligible",
    reason_code: "eligible",
    ...overrides,
  };
}

describe("former-member request contract", () => {
  it("accepts exact preview and remove bodies and normalizes UUID case", () => {
    expect(
      parseFormerMemberRequest({
        action: "preview",
        userIds: [id.toUpperCase()],
      }),
    ).toEqual({ action: "preview", userIds: [id] });
    expect(
      parseFormerMemberRequest({
        action: "remove",
        userIds: [id],
        confirmation: "REMOVE 1 MEMBERS",
      }),
    ).toEqual({
      action: "remove",
      userIds: [id],
      confirmation: "REMOVE 1 MEMBERS",
    });
  });

  it("rejects empty, duplicate, oversized, malformed, and extra-key requests", () => {
    const fiftyOne = Array.from(
      { length: 51 },
      (_, index) =>
        `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(
      parseFormerMemberRequest({ action: "preview", userIds: [] }),
    ).toBeNull();
    expect(
      parseFormerMemberRequest({
        action: "preview",
        userIds: [id, id.toUpperCase()],
      }),
    ).toBeNull();
    expect(
      parseFormerMemberRequest({ action: "preview", userIds: fiftyOne }),
    ).toBeNull();
    expect(
      parseFormerMemberRequest({ action: "preview", userIds: ["not-a-uuid"] }),
    ).toBeNull();
    expect(
      parseFormerMemberRequest({
        action: "preview",
        userIds: [id],
        role: "Admin",
      }),
    ).toBeNull();
  });

  it("accepts exactly 50 unique UUIDs", () => {
    const fifty = Array.from(
      { length: 50 },
      (_, index) =>
        `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(
      parseFormerMemberRequest({ action: "preview", userIds: fifty }),
    ).toEqual({
      action: "preview",
      userIds: fifty,
    });
  });

  it("creates the exact owner-approved confirmation", () => {
    expect(expectedFormerMemberConfirmation(1)).toBe("REMOVE 1 MEMBERS");
    expect(expectedFormerMemberConfirmation(50)).toBe("REMOVE 50 MEMBERS");
  });
});

describe("former-member RPC contracts", () => {
  it("parses ordered preview rows and nullable unavailable fields", () => {
    expect(parseFormerMemberPreviewRows([previewRow()], [id])).toEqual([
      expect.objectContaining({
        userId: id,
        outcome: "eligible",
        openTaskCount: 0,
      }),
    ]);
    expect(
      parseFormerMemberPreviewRows(
        [
          previewRow({
            full_name: null,
            email: null,
            role: null,
            is_active: null,
            outcome: "skipped",
            reason_code: "unavailable",
          }),
        ],
        [id],
      ),
    ).not.toBeNull();
  });

  it("rejects missing, reordered, mismatched, or impossible preview rows", () => {
    expect(parseFormerMemberPreviewRows([], [id])).toBeNull();
    expect(
      parseFormerMemberPreviewRows(
        [previewRow({ input_ordinal: 2, user_id: otherId })],
        [id],
      ),
    ).toBeNull();
    expect(
      parseFormerMemberPreviewRows(
        [previewRow({ outcome: "eligible", reason_code: "open_tasks" })],
        [id],
      ),
    ).toBeNull();
  });

  it("requires deterministic identity data for DB completion outcomes", () => {
    expect(
      parseAnonymizeRpcRow(
        [
          {
            out_user_id: id,
            out_outcome: "anonymized",
            out_reason_code: "anonymized",
            out_email: `${id}@former.invalid`,
            out_anonymized_at: timestamp,
          },
        ],
        id,
      ),
    ).toEqual({
      userId: id,
      outcome: "anonymized",
      reasonCode: "anonymized",
      email: `${id}@former.invalid`,
      anonymizedAt: timestamp,
    });
    expect(
      parseAnonymizeRpcRow(
        [
          {
            out_user_id: id,
            out_outcome: "already_anonymized",
            out_reason_code: "already_anonymized",
            out_email: "wrong@example.com",
            out_anonymized_at: timestamp,
          },
        ],
        id,
      ),
    ).toBeNull();
  });

  it("rejects impossible skipped database outcomes", () => {
    expect(
      parseAnonymizeRpcRow(
        [
          {
            out_user_id: id,
            out_outcome: "skipped",
            out_reason_code: "eligible",
            out_email: "test@example.com",
            out_anonymized_at: null,
          },
        ],
        id,
      ),
    ).toBeNull();
  });

  it("accepts only an exact idempotent Auth cleanup result", () => {
    expect(
      parseCleanupFormerMemberAuthRpcRow(
        [
          {
            out_user_id: id,
            out_outcome: "cleaned",
            out_email_identity_count: 0,
          },
        ],
        id,
      ),
    ).toEqual({ userId: id, outcome: "cleaned", emailIdentityCount: 0 });
    expect(
      parseCleanupFormerMemberAuthRpcRow(
        [
          {
            out_user_id: id,
            out_outcome: "cleaned",
            out_email_identity_count: 1,
          },
        ],
        id,
      ),
    ).toEqual({ userId: id, outcome: "cleaned", emailIdentityCount: 1 });
  });

  it("rejects malformed or ambiguous Auth cleanup results", () => {
    expect(parseCleanupFormerMemberAuthRpcRow([], id)).toBeNull();
    expect(
      parseCleanupFormerMemberAuthRpcRow(
        [
          {
            out_user_id: otherId,
            out_outcome: "cleaned",
            out_email_identity_count: 1,
          },
        ],
        id,
      ),
    ).toBeNull();
    expect(
      parseCleanupFormerMemberAuthRpcRow(
        [
          {
            out_user_id: id,
            out_outcome: "cleaned",
            out_email_identity_count: 2,
          },
        ],
        id,
      ),
    ).toBeNull();
  });
});

describe("former-member browser response contracts", () => {
  const preview = {
    count: 1,
    users: [
      {
        inputOrdinal: 1,
        userId: id,
        fullName: "Test Member",
        email: "test@example.com",
        role: "Member",
        committeeId: null,
        isActive: false,
        anonymizedAt: null,
        openTaskCount: 0,
        outcome: "eligible",
        reasonCode: "eligible",
      },
    ],
  };

  it("accepts only an ordered authoritative preview", () => {
    expect(parseFormerMemberPreviewPayload(preview, [id])).toEqual(preview);
    expect(
      parseFormerMemberPreviewPayload({ ...preview, count: 2 }, [id]),
    ).toBeNull();
    expect(
      parseFormerMemberPreviewPayload(
        {
          ...preview,
          users: [{ ...preview.users[0], userId: otherId }],
        },
        [id],
      ),
    ).toBeNull();
    expect(
      parseFormerMemberPreviewPayload({ ...preview, private: true }, [id]),
    ).toBeNull();
  });

  it("accepts ordered results and rejects missing or reordered entries", () => {
    const payload = {
      results: [
        {
          userId: id,
          state: "cleanup-pending",
          message: "Identity cleanup is pending.",
        },
      ],
    };
    expect(parseFormerMemberRemovalPayload(payload, [id])).toEqual(payload);
    expect(parseFormerMemberRemovalPayload({ results: [] }, [id])).toBeNull();
    expect(parseFormerMemberRemovalPayload(payload, [otherId])).toBeNull();
  });
});

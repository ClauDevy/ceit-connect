import { isUuid } from "@/lib/users/management-contracts";

export const MAX_FORMER_MEMBER_REMOVALS = 50;

export type FormerMemberPreviewOutcome =
  "eligible" | "already_anonymized" | "skipped";

export type FormerMemberReasonCode =
  | "eligible"
  | "already_anonymized"
  | "self"
  | "admin"
  | "active"
  | "open_tasks"
  | "unavailable";

export type FormerMemberPreview = {
  inputOrdinal: number;
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string | null;
  committeeId: string | null;
  isActive: boolean | null;
  anonymizedAt: string | null;
  openTaskCount: number;
  outcome: FormerMemberPreviewOutcome;
  reasonCode: FormerMemberReasonCode;
};

export type FormerMemberRemovalState =
  "removed" | "skipped" | "failed" | "cleanup-pending";

export type FormerMemberRemovalResult = {
  userId: string;
  state: FormerMemberRemovalState;
  message: string;
  reasonCode?: FormerMemberReasonCode;
};

export type FormerMemberRequest =
  | { action: "preview"; userIds: string[] }
  | { action: "remove"; userIds: string[]; confirmation: string };

type PreviewRpcRow = {
  input_ordinal: number;
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  committee_id: string | null;
  is_active: boolean | null;
  anonymized_at: string | null;
  open_task_count: number;
  outcome: FormerMemberPreviewOutcome;
  reason_code: FormerMemberReasonCode;
};

export type AnonymizeRpcRow = {
  userId: string;
  outcome: "anonymized" | "already_anonymized" | "skipped";
  reasonCode: "anonymized" | FormerMemberReasonCode;
  email: string | null;
  anonymizedAt: string | null;
};

export type CleanupFormerMemberAuthRpcRow = {
  userId: string;
  outcome: "cleaned";
  emailIdentityCount: 0 | 1;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableUuid(value: unknown): value is string | null {
  return value === null || isUuid(value);
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isReasonCode(value: unknown): value is FormerMemberReasonCode {
  return (
    value === "eligible" ||
    value === "already_anonymized" ||
    value === "self" ||
    value === "admin" ||
    value === "active" ||
    value === "open_tasks" ||
    value === "unavailable"
  );
}

function validOutcomePair(
  outcome: unknown,
  reasonCode: FormerMemberReasonCode,
): outcome is FormerMemberPreviewOutcome {
  return (
    (outcome === "eligible" && reasonCode === "eligible") ||
    (outcome === "already_anonymized" && reasonCode === "already_anonymized") ||
    (outcome === "skipped" &&
      reasonCode !== "eligible" &&
      reasonCode !== "already_anonymized")
  );
}

export function parseFormerMemberRequest(
  value: unknown,
): FormerMemberRequest | null {
  if (!isRecord(value) || !Array.isArray(value.userIds)) return null;
  if (value.action !== "preview" && value.action !== "remove") return null;

  const allowedKeys =
    value.action === "preview"
      ? ["action", "userIds"]
      : ["action", "userIds", "confirmation"];
  if (!hasOnlyKeys(value, allowedKeys)) return null;
  if (
    value.userIds.length < 1 ||
    value.userIds.length > MAX_FORMER_MEMBER_REMOVALS ||
    !value.userIds.every(isUuid)
  ) {
    return null;
  }

  const userIds = value.userIds.map((userId) => userId.toLowerCase());
  if (new Set(userIds).size !== userIds.length) return null;

  if (value.action === "preview") return { action: "preview", userIds };
  if (typeof value.confirmation !== "string") return null;
  return { action: "remove", userIds, confirmation: value.confirmation };
}

export function expectedFormerMemberConfirmation(count: number) {
  return `REMOVE ${count} MEMBERS`;
}

export function parseFormerMemberPreviewRows(
  value: unknown,
  requestedUserIds: readonly string[],
): FormerMemberPreview[] | null {
  if (!Array.isArray(value) || value.length !== requestedUserIds.length) {
    return null;
  }

  const parsed: FormerMemberPreview[] = [];
  for (const [index, unknownRow] of value.entries()) {
    if (!isRecord(unknownRow)) return null;
    const row = unknownRow as Partial<PreviewRpcRow>;
    if (
      row.input_ordinal !== index + 1 ||
      !isUuid(row.user_id) ||
      row.user_id.toLowerCase() !== requestedUserIds[index]?.toLowerCase() ||
      !isNullableString(row.full_name) ||
      !isNullableString(row.email) ||
      !isNullableString(row.role) ||
      !isNullableUuid(row.committee_id) ||
      !isNullableBoolean(row.is_active) ||
      !(row.anonymized_at === null || isTimestamp(row.anonymized_at)) ||
      !Number.isSafeInteger(row.open_task_count) ||
      (row.open_task_count ?? -1) < 0 ||
      !isReasonCode(row.reason_code) ||
      !validOutcomePair(row.outcome, row.reason_code)
    ) {
      return null;
    }

    parsed.push({
      inputOrdinal: row.input_ordinal,
      userId: row.user_id.toLowerCase(),
      fullName: row.full_name,
      email: row.email,
      role: row.role,
      committeeId: row.committee_id,
      isActive: row.is_active,
      anonymizedAt: row.anonymized_at,
      openTaskCount: row.open_task_count as number,
      outcome: row.outcome,
      reasonCode: row.reason_code,
    });
  }
  return parsed;
}

export function parseAnonymizeRpcRow(
  value: unknown,
  expectedUserId: string,
): AnonymizeRpcRow | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }
  const row = value[0];
  if (
    !isUuid(row.out_user_id) ||
    row.out_user_id.toLowerCase() !== expectedUserId.toLowerCase() ||
    (row.out_outcome !== "anonymized" &&
      row.out_outcome !== "already_anonymized" &&
      row.out_outcome !== "skipped") ||
    typeof row.out_reason_code !== "string" ||
    !isNullableString(row.out_email) ||
    !(row.out_anonymized_at === null || isTimestamp(row.out_anonymized_at))
  ) {
    return null;
  }

  if (row.out_outcome === "anonymized") {
    if (
      row.out_reason_code !== "anonymized" ||
      row.out_email !== `${expectedUserId.toLowerCase()}@former.invalid` ||
      !isTimestamp(row.out_anonymized_at)
    ) {
      return null;
    }
  } else if (row.out_outcome === "already_anonymized") {
    if (
      row.out_reason_code !== "already_anonymized" ||
      row.out_email !== `${expectedUserId.toLowerCase()}@former.invalid` ||
      !isTimestamp(row.out_anonymized_at)
    ) {
      return null;
    }
  } else {
    if (
      row.out_reason_code !== "self" &&
      row.out_reason_code !== "admin" &&
      row.out_reason_code !== "active" &&
      row.out_reason_code !== "open_tasks" &&
      row.out_reason_code !== "unavailable"
    ) {
      return null;
    }
  }

  return {
    userId: row.out_user_id.toLowerCase(),
    outcome: row.out_outcome,
    reasonCode: row.out_reason_code as AnonymizeRpcRow["reasonCode"],
    email: row.out_email,
    anonymizedAt: row.out_anonymized_at,
  };
}

export function parseCleanupFormerMemberAuthRpcRow(
  value: unknown,
  expectedUserId: string,
): CleanupFormerMemberAuthRpcRow | null {
  if (!Array.isArray(value) || value.length !== 1 || !isRecord(value[0])) {
    return null;
  }

  const row = value[0];
  if (
    !isUuid(row.out_user_id) ||
    row.out_user_id.toLowerCase() !== expectedUserId.toLowerCase() ||
    row.out_outcome !== "cleaned" ||
    (row.out_email_identity_count !== 0 && row.out_email_identity_count !== 1)
  ) {
    return null;
  }

  return {
    userId: row.out_user_id.toLowerCase(),
    outcome: "cleaned",
    emailIdentityCount: row.out_email_identity_count,
  };
}

export function skippedFormerMemberMessage(reason: FormerMemberReasonCode) {
  if (reason === "active") return "This account is active and was not removed.";
  if (reason === "open_tasks") {
    return "This account still has open tasks and was not removed.";
  }
  return "This account is unavailable for removal.";
}

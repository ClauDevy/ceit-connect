import { getNormalizedEmailDomain } from "../allowed-email-domains";
import { isCanonicalUuid } from "../uuid";

export type OfficerInviteState =
  | "sent"
  | "failed"
  | "unsent"
  | "cleanup-pending";

export type OfficerRole = "Admin" | "Co-Admin";

export type OfficerInviteInput = {
  clientId: string;
  inviteId: string | null;
  email: string;
  fullName: string;
  role: OfficerRole;
  committeeId: string | null;
};

export type OfficerInviteResult = OfficerInviteInput & {
  inviteId: string | null;
  authUserId?: string;
  state: OfficerInviteState;
  message: string;
};

export function isUuid(value: unknown): value is string {
  return isCanonicalUuid(value);
}

export function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isAuthEmailRateLimit(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: unknown }).status;
  const code = (error as { code?: unknown }).code;
  return (
    status === 429 &&
    (code === "over_email_send_rate_limit" ||
      code === "over_request_rate_limit")
  );
}

const ERROR_MESSAGES: Record<string, { message: string; state: OfficerInviteState }> = {
  CCO01: {
    message: "Only active Admins can manage officers.",
    state: "failed",
  },
  CCO02: {
    message: "Check this officer's name, role, and committee.",
    state: "failed",
  },
  CCO03: {
    message: "This person is not eligible for this officer action.",
    state: "failed",
  },
  CCO04: {
    message: "That officer seat is currently full.",
    state: "unsent",
  },
  CCO05: {
    message: "Officer settings are temporarily unavailable. Try again.",
    state: "unsent",
  },
  CCO06: {
    message:
      "This invitation changed while it was being processed. Retry to reconcile it.",
    state: "cleanup-pending",
  },
  CCO07: {
    message: "An accepted invitation can no longer be cancelled.",
    state: "failed",
  },
  CCO08: {
    message: "This officer account could not be changed through that action.",
    state: "failed",
  },
  CCO09: {
    message: "The last active Admin cannot step down.",
    state: "failed",
  },
};

export function safeOfficerError(error: unknown) {
  const code = getErrorCode(error);
  return (
    (code ? ERROR_MESSAGES[code] : undefined) ?? {
      message: "The officer action could not be completed. Try again.",
      state: "failed" as const,
    }
  );
}

export function parseInviteInput(
  value: unknown,
  allowedDomains: readonly string[],
): OfficerInviteInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.clientId !== "string" ||
    !row.clientId ||
    typeof row.email !== "string" ||
    typeof row.fullName !== "string" ||
    (row.role !== "Admin" && row.role !== "Co-Admin") ||
    (row.inviteId !== undefined &&
      row.inviteId !== null &&
      !isUuid(row.inviteId)) ||
    (row.committeeId !== null &&
      row.committeeId !== undefined &&
      !isUuid(row.committeeId))
  ) {
    return null;
  }

  const email = row.email.trim().toLowerCase();
  const fullName = row.fullName.trim();
  const domain = getNormalizedEmailDomain(email);
  const committeeId = typeof row.committeeId === "string" ? row.committeeId : null;
  if (
    !domain ||
    !allowedDomains.includes(domain) ||
    fullName.length < 1 ||
    fullName.length > 100 ||
    /[\u0000-\u001f\u007f]/.test(fullName) ||
    (row.role === "Admin" && committeeId !== null) ||
    (row.role === "Co-Admin" && committeeId === null)
  ) {
    return null;
  }

  return {
    clientId: row.clientId,
    inviteId: typeof row.inviteId === "string" ? row.inviteId : null,
    email,
    fullName,
    role: row.role,
    committeeId,
  };
}

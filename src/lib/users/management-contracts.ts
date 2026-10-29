import { isCanonicalUuid } from "@/lib/uuid";

export const MEMBER_MANAGEMENT_CLEANUP_MESSAGE =
  "The invitation could not be completed and cleanup still needs attention. Contact an Admin before retrying.";

export function isUuid(value: unknown): value is string {
  return isCanonicalUuid(value);
}

export function getDatabaseErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

const MEMBER_ERROR_MESSAGES: Record<
  string,
  { status: number; message: string }
> = {
  CCM01: {
    status: 403,
    message: "You no longer have permission to manage these members.",
  },
  CCM02: {
    status: 400,
    message: "Check the submitted details and try again.",
  },
  CCM03: {
    status: 404,
    message: "The selected Member is unavailable.",
  },
  CCM04: {
    status: 409,
    message: "This Member's status changed. Refresh and try again.",
  },
  CCM05: {
    status: 400,
    message:
      "Full name must be 1 to 100 characters and cannot contain line breaks or control characters.",
  },
  CCM06: {
    status: 409,
    message: "The invitation could not be verified. Please retry the invitation.",
  },
  CCM07: {
    status: 409,
    message: "An account or officer invitation already uses this email.",
  },
  CCM08: {
    status: 400,
    message: "Select a valid committee.",
  },
  CCM09: {
    status: 409,
    message: "The Member record changed unexpectedly. Refresh and try again.",
  },
};

export function safeMemberManagementError(
  error: unknown,
  fallback = "The Member action could not be completed. Try again.",
) {
  const code = getDatabaseErrorCode(error);
  return {
    code,
    ...(code ? MEMBER_ERROR_MESSAGES[code] : undefined),
    ...(!code || !MEMBER_ERROR_MESSAGES[code]
      ? { status: 500, message: fallback }
      : {}),
  };
}

export function isMemberManagementErrorCode(
  code: string | null,
): code is `CCM0${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` {
  return Boolean(code && /^CCM0[1-9]$/.test(code));
}

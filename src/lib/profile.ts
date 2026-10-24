import { z } from "zod";

export const MAX_PROFILE_NAME_CODE_POINTS = 100;

const PROFILE_NAME_CONTROL_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;

// Keep this set exactly aligned with update_own_profile(text). Controls and
// U+2028/U+2029 are rejected, not trimmed.
const PROFILE_NAME_EDGE_WHITESPACE_PATTERN =
  /^[\u0020\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+|[\u0020\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000\ufeff]+$/gu;

const PROFILE_NAME_MESSAGE =
  "Full name must be 1 to 100 characters and cannot contain control characters or line breaks.";

export function countProfileNameCodePoints(value: string) {
  return Array.from(value).length;
}

export function trimProfileName(value: string) {
  return value.replace(PROFILE_NAME_EDGE_WHITESPACE_PATTERN, "");
}

export const profileNameSchema = z
  .string()
  .transform(trimProfileName)
  .refine((value) => !PROFILE_NAME_CONTROL_PATTERN.test(value), {
    message: PROFILE_NAME_MESSAGE,
  })
  .refine(
    (value) => {
      const length = countProfileNameCodePoints(value);
      return length >= 1 && length <= MAX_PROFILE_NAME_CODE_POINTS;
    },
    { message: PROFILE_NAME_MESSAGE },
  );

export function getProfileNameErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "CCP01") return "Your profile is unavailable.";
    if (code === "CCP02") return PROFILE_NAME_MESSAGE;
  }
  return "We couldn't save your name. Try again.";
}

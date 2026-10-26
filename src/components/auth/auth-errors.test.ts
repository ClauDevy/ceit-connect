import { describe, expect, it } from "vitest";
import { AUTH_ERROR_MESSAGES } from "./auth-errors";

describe("login error messages", () => {
  it("keeps current and legacy callback links generic", () => {
    expect(AUTH_ERROR_MESSAGES.auth).toBe("Something went wrong. Please try again.");
    expect(AUTH_ERROR_MESSAGES.not_invited).toBe(AUTH_ERROR_MESSAGES.auth);
    expect(AUTH_ERROR_MESSAGES.set_password_first).toBe(
      AUTH_ERROR_MESSAGES.auth,
    );
  });
});

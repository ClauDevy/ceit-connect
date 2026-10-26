import { describe, expect, it } from "vitest";
import { isAuthEmailRateLimit, safeOfficerError } from "./contracts";

describe("officer route contracts", () => {
  it.each([
    ["CCO01", "failed"],
    ["CCO02", "failed"],
    ["CCO03", "failed"],
    ["CCO04", "unsent"],
    ["CCO05", "unsent"],
    ["CCO06", "cleanup-pending"],
    ["CCO07", "failed"],
    ["CCO08", "failed"],
    ["CCO09", "failed"],
  ])("maps %s to a safe %s result", (code, state) => {
    const mapped = safeOfficerError({ code, message: "private database text" });
    expect(mapped.state).toBe(state);
    expect(mapped.message).not.toContain("private");
  });

  it("recognizes only installed 429 rate-limit status/code pairs", () => {
    expect(
      isAuthEmailRateLimit({ status: 429, code: "over_email_send_rate_limit" }),
    ).toBe(true);
    expect(
      isAuthEmailRateLimit({ status: 429, code: "over_request_rate_limit" }),
    ).toBe(true);
    expect(
      isAuthEmailRateLimit({ status: 400, code: "over_email_send_rate_limit" }),
    ).toBe(false);
    expect(isAuthEmailRateLimit({ status: 429, message: "rate limit" })).toBe(false);
  });
});

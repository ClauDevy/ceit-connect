import { describe, expect, it } from "vitest";
import { isUuid, safeMemberManagementError } from "./management-contracts";

describe("member management contracts", () => {
  it("accepts strict UUIDs only", () => {
    expect(isUuid("10000000-0000-4000-8000-000000000001")).toBe(true);
    expect(isUuid("user-1")).toBe(false);
  });

  it.each([
    ["CCM01", 403],
    ["CCM02", 400],
    ["CCM03", 404],
    ["CCM04", 409],
    ["CCM05", 400],
    ["CCM06", 409],
    ["CCM07", 409],
    ["CCM08", 400],
    ["CCM09", 409],
    ["CCG01", 409],
    ["CCG02", 409],
  ])("maps %s without exposing database text", (code, status) => {
    const safe = safeMemberManagementError({ code, message: "private" });
    expect(safe.status).toBe(status);
    expect(safe.message).not.toContain("private");
  });

  it("keeps the last-Admin guard text fixed", () => {
    expect(
      safeMemberManagementError({ code: "CCG02", message: "private" }),
    ).toEqual({
      code: "CCG02",
      status: 409,
      message: "At least one active Admin is required.",
    });
  });

  it("uses a safe fallback for unknown errors", () => {
    expect(safeMemberManagementError({ message: "private" })).toEqual({
      code: null,
      status: 500,
      message: "The Member action could not be completed. Try again.",
    });
  });
});

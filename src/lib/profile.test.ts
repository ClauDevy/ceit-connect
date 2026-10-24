import { describe, expect, it } from "vitest";
import {
  countProfileNameCodePoints,
  getProfileNameErrorMessage,
  profileNameSchema,
  trimProfileName,
} from "./profile";

describe("profile name validation", () => {
  it("uses Unicode code points rather than UTF-16 code units", () => {
    expect(countProfileNameCodePoints("A🙂B")).toBe(3);
    expect(profileNameSchema.parse("🙂".repeat(100))).toBe("🙂".repeat(100));
    expect(profileNameSchema.safeParse("🙂".repeat(101)).success).toBe(false);
    expect(profileNameSchema.safeParse("🙂".repeat(1001)).success).toBe(false);
  });

  it("trims the explicit shared whitespace set, including NBSP", () => {
    expect(trimProfileName("\u00a0\u3000 Maria Santos \ufeff")).toBe(
      "Maria Santos",
    );
    expect(profileNameSchema.parse("\u00a0 Maria Santos \u00a0")).toBe(
      "Maria Santos",
    );
    expect(profileNameSchema.safeParse("\u00a0\u00a0").success).toBe(false);
  });

  it("rejects empty names, controls, DEL, NEL, and line separators", () => {
    for (const value of [
      "",
      "   ",
      "Name\u0000",
      "Name\t",
      "Name\n",
      "Name\u007f",
      "Name\u0085",
      "Name\u2028",
      "Name\u2029",
    ]) {
      expect(profileNameSchema.safeParse(value).success, value).toBe(false);
    }
  });

  it("maps only the stable profile SQLSTATEs", () => {
    expect(getProfileNameErrorMessage({ code: "CCP01" })).toBe(
      "Your profile is unavailable.",
    );
    expect(getProfileNameErrorMessage({ code: "CCP02" })).toContain(
      "1 to 100 characters",
    );
    expect(getProfileNameErrorMessage({ code: "unexpected" })).toBe(
      "We couldn't save your name. Try again.",
    );
  });
});

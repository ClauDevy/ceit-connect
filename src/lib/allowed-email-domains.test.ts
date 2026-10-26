import { describe, expect, it } from "vitest";
import {
  getNormalizedEmailDomain,
  parseAllowedEmailDomains,
} from "./allowed-email-domains";

describe("allowed email domains", () => {
  it("matches the invite parser's trim, lowercase, and empty removal rules", () => {
    expect(parseAllowedEmailDomains(" Example.EDU, ,GMAIL.com ")).toEqual([
      "example.edu",
      "gmail.com",
    ]);
    expect(parseAllowedEmailDomains(undefined)).toEqual([]);
  });

  it("accepts exactly one at-sign with non-empty local and domain parts", () => {
    expect(getNormalizedEmailDomain(" User@Example.EDU ")).toBe("example.edu");
    expect(getNormalizedEmailDomain("userexample.edu")).toBeNull();
    expect(getNormalizedEmailDomain("@example.edu")).toBeNull();
    expect(getNormalizedEmailDomain("user@")).toBeNull();
    expect(getNormalizedEmailDomain("user@other@example.edu")).toBeNull();
  });
});

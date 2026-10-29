import { describe, expect, it } from "vitest";
import { isCanonicalUuid } from "./uuid";

describe("canonical UUID validation", () => {
  it.each([
    ["UUIDv1", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"],
    ["UUIDv4", "550e8400-e29b-41d4-a716-446655440000"],
    ["UUIDv7", "01890f3e-9b5a-7cc2-98c8-5f683c4f6e21"],
    ["uppercase hex", "550E8400-E29B-41D4-A716-446655440000"],
    ["mixed-case hex", "550e8400-E29B-41d4-a716-446655440000"],
    ["nil UUID", "00000000-0000-0000-0000-000000000000"],
    ["non-RFC variant nibble", "550e8400-e29b-41d4-0716-446655440000"],
  ])("accepts %s", (_, value) => {
    expect(isCanonicalUuid(value)).toBe(true);
  });

  it.each([
    ["wrong length", "550e8400-e29b-41d4-a716-44665544000"],
    ["non-hex character", "550e8400-e29b-41d4-a716-44665544000g"],
    ["braces", "{550e8400-e29b-41d4-a716-446655440000}"],
    ["surrounding spaces", " 550e8400-e29b-41d4-a716-446655440000 "],
    ["trailing newline", "550e8400-e29b-41d4-a716-446655440000\n"],
    ["missing hyphen", "550e8400e29b-41d4-a716-446655440000"],
  ])("rejects %s", (_, value) => {
    expect(isCanonicalUuid(value)).toBe(false);
  });

  it.each([null, undefined, 123])("rejects non-string input %s", (value) => {
    expect(isCanonicalUuid(value)).toBe(false);
  });
});

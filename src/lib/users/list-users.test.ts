import { describe, expect, it, vi } from "vitest";
import {
  MAX_USERS_OFFSET,
  buildUsersSearchFilter,
  isStrictUuid,
  listUsersPage,
  matchingCommitteeIds,
  normalizeUsersSearch,
  parseUsersOffset,
  parseUsersStatus,
  truncateUsersSearch,
} from "./list-users";

const committeeId = "123e4567-e89b-42d3-a456-426614174000";

function expected(pattern: string) {
  return [
    `full_name.ilike.${pattern}`,
    `email.ilike.${pattern}`,
    `role.ilike.${pattern}`,
  ].join(",");
}

describe("Users search filter", () => {
  it.each([
    ["%", expected('"%\\\\%%"')],
    ["_", expected('"%\\\\_%"')],
    ["\\", expected('"%\\\\\\\\%"')],
    ['"', expected('"%\\"%"')],
    [",", expected('"%,%"')],
    ["()", expected('"%()%"')],
    [".", expected('"%.%"')],
  ])("constructs the exact safe filter for %j", (search, filter) => {
    expect(buildUsersSearchFilter(search, [])).toBe(filter);
  });

  it("adds only strictly validated committee UUIDs", () => {
    expect(buildUsersSearchFilter("cia", [committeeId])).toBe(
      `${expected('"%cia%"')},committee_id.in.(${committeeId})`,
    );
    expect(() => buildUsersSearchFilter("cia", ["committee-1"])).toThrow(
      "Invalid committee id returned by the lookup.",
    );
  });

  it("matches committee names case-insensitively as literal text", () => {
    const committees = [
      { id: committeeId, name: "CIA" },
      {
        id: "223e4567-e89b-42d3-a456-426614174000",
        name: "COEXA",
      },
    ];
    expect(matchingCommitteeIds(committees, "Ci")).toEqual([committeeId]);
    expect(matchingCommitteeIds(committees, "%")).toEqual([]);
  });

  it("requires strict UUID syntax", () => {
    expect(isStrictUuid(committeeId)).toBe(true);
    expect(isStrictUuid("123e4567-e89b-12d3-a456-426614174000")).toBe(true);
    expect(isStrictUuid("123e4567-e89b-02d3-a456-426614174000")).toBe(false);
    expect(isStrictUuid(`${committeeId},id.eq.attacker`)).toBe(false);
  });
});

describe("Users request validation", () => {
  it("trims and bounds search by Unicode code points", () => {
    expect(normalizeUsersSearch("  Claude  ")).toEqual({
      ok: true,
      value: "Claude",
    });
    expect(normalizeUsersSearch("🐯".repeat(100)).ok).toBe(true);
    expect(normalizeUsersSearch("🐯".repeat(101)).ok).toBe(false);
    expect(truncateUsersSearch(` ${"🐯".repeat(101)}`)).toBe(
      ` ${"🐯".repeat(99)}`,
    );
  });

  it("accepts only bounded page offsets in increments of 20", () => {
    expect(parseUsersOffset("0")).toBe(0);
    expect(parseUsersOffset("20")).toBe(20);
    expect(parseUsersOffset(String(MAX_USERS_OFFSET))).toBe(MAX_USERS_OFFSET);
    expect(parseUsersOffset("21")).toBeNull();
    expect(parseUsersOffset("-20")).toBeNull();
    expect(parseUsersOffset(String(MAX_USERS_OFFSET + 20))).toBeNull();
  });

  it("accepts only the two roster statuses", () => {
    expect(parseUsersStatus("active")).toBe("active");
    expect(parseUsersStatus("deactivated")).toBe("deactivated");
    expect(parseUsersStatus("all")).toBeNull();
  });
});

describe("Users roster query", () => {
  it("makes one status-scoped, searched, ordered fetch-21 query", async () => {
    const range = vi.fn().mockResolvedValue({ data: [], error: null });
    const secondOrder = vi.fn(() => ({ range }));
    const firstOrder = vi.fn(() => ({ order: secondOrder }));
    const or = vi.fn(() => ({ order: firstOrder }));
    const eq = vi.fn(() => ({ or }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));

    await listUsersPage(
      { from } as never,
      {
        committees: [{ id: committeeId, name: "CIA" }],
        offset: 20,
        search: "cia",
        status: "deactivated",
      },
    );

    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("users");
    expect(eq).toHaveBeenCalledWith("is_active", false);
    expect(or).toHaveBeenCalledWith(
      `${expected('"%cia%"')},committee_id.in.(${committeeId})`,
    );
    expect(firstOrder).toHaveBeenCalledWith("full_name", { ascending: true });
    expect(secondOrder).toHaveBeenCalledWith("id", { ascending: true });
    expect(range).toHaveBeenCalledWith(20, 40);
  });
});

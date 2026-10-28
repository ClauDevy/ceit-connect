import { describe, expect, it, vi } from "vitest";
import {
  MAX_USERS_OFFSET,
  listUsersPage,
  normalizeUsersSearch,
  parseUsersOffset,
  parseUsersStatus,
  truncateUsersSearch,
} from "./list-users";

const rows = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    full_name: "Admin A",
    email: "admin@example.edu",
    role: "Admin",
    committee_id: null,
    avatar_url: null,
    is_active: true,
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    full_name: "Co-Admin B",
    email: "coadmin@example.edu",
    role: "Co-Admin",
    committee_id: "20000000-0000-4000-8000-000000000001",
    avatar_url: "https://example.test/avatar.webp",
    is_active: true,
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    full_name: "Member C",
    email: "member@example.edu",
    role: "Member",
    committee_id: "20000000-0000-4000-8000-000000000002",
    avatar_url: null,
    is_active: true,
  },
];

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

describe("Users management reader", () => {
  it("enriches only authorized deactivated rows and preserves their ordering", async () => {
    const deactivatedRows = rows.map((row) => ({ ...row, is_active: false }));
    const rpc = vi.fn().mockResolvedValue({ data: deactivatedRows, error: null });
    const markerIn = vi.fn().mockResolvedValue({
      data: deactivatedRows.map((row, index) => ({
        id: row.id,
        anonymized_at: index === 1 ? "2026-10-27T12:00:00Z" : null,
      })),
      error: null,
    });
    const from = vi.fn(() => ({
      select: vi.fn(() => ({ in: markerIn })),
    }));
    const result = await listUsersPage({ rpc, from } as never, {
      offset: 20,
      search: "committee name",
      status: "deactivated",
    });

    expect(rpc).toHaveBeenCalledWith("list_managed_users", {
      p_is_active: false,
      p_search: "committee name",
      p_offset: 20,
    });
    expect(from).toHaveBeenCalledWith("users");
    expect(markerIn).toHaveBeenCalledWith(
      "id",
      deactivatedRows.map((row) => row.id),
    );
    expect(result).toEqual({
      data: deactivatedRows.map((row, index) => ({
        ...row,
        anonymized_at: index === 1 ? "2026-10-27T12:00:00Z" : null,
      })),
      error: null,
    });
  });

  it("sets active rows to a non-terminal state without a second read", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    const from = vi.fn();
    const result = await listUsersPage({ rpc, from } as never, {
      offset: 0,
      search: "",
      status: "active",
    });
    expect(from).not.toHaveBeenCalled();
    expect(result.data).toEqual(
      rows.map((row) => ({ ...row, anonymized_at: null })),
    );
  });

  it.each([
    { name: "an error", data: [], error: new Error("private") },
    { name: "a missing row", data: [], error: null },
    {
      name: "a duplicate row",
      data: [
        { id: rows[0].id, anonymized_at: null },
        { id: rows[0].id, anonymized_at: null },
        { id: rows[2].id, anonymized_at: null },
      ],
      error: null,
    },
    {
      name: "an unauthorized extra row",
      data: [
        ...rows.map((row) => ({ id: row.id, anonymized_at: null })),
        { id: "10000000-0000-4000-8000-000000000099", anonymized_at: null },
      ],
      error: null,
    },
    {
      name: "an invalid timestamp",
      data: rows.map((row, index) => ({
        id: row.id,
        anonymized_at: index === 0 ? "not-a-timestamp" : null,
      })),
      error: null,
    },
  ])("fails closed when marker enrichment returns $name", async ({ data, error }) => {
    const client = {
      rpc: vi.fn().mockResolvedValue({
        data: rows.map((row) => ({ ...row, is_active: false })),
        error: null,
      }),
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          in: vi.fn().mockResolvedValue({ data, error }),
        })),
      })),
    };
    const result = await listUsersPage(client as never, {
      offset: 0,
      search: "",
      status: "deactivated",
    });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it.each(["%", "_", "\\"])(
    "passes literal search text %j unchanged to the reader",
    async (search) => {
      const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
      await listUsersPage({ rpc } as never, {
        offset: 0,
        search,
        status: "active",
      });
      expect(rpc).toHaveBeenCalledWith("list_managed_users", {
        p_is_active: true,
        p_search: search,
        p_offset: 0,
      });
    },
  );

  it("sends null for an empty search", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    await listUsersPage({ rpc } as never, {
      offset: 0,
      search: "",
      status: "active",
    });
    expect(rpc).toHaveBeenCalledWith("list_managed_users", {
      p_is_active: true,
      p_search: null,
      p_offset: 0,
    });
  });

  it("fails closed when the reader returns a malformed row", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...rows[0], avatar_url: 7 }],
      error: null,
    });
    const result = await listUsersPage({ rpc } as never, {
      offset: 0,
      search: "",
      status: "active",
    });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});

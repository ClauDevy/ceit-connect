import { describe, expect, it } from "vitest";
import type { Member } from "@/lib/types";
import {
  getSelectableFormerMemberIds,
  toggleVisibleFormerMemberSelection,
  updateFormerMemberSelection,
} from "./former-member-selection";

function member(id: string, role = "Member", anonymized = false): Member {
  return {
    id,
    full_name: anonymized ? "Former member" : `Member ${id}`,
    email: `${id}@example.edu`,
    role,
    committee_id: role === "Admin" ? null : "committee-1",
    avatar_url: null,
    is_active: false,
    anonymized_at: anonymized ? "2026-10-27T12:00:00Z" : null,
  };
}

describe("former-member visible selection", () => {
  it("excludes anonymized and Admin rows", () => {
    expect(
      getSelectableFormerMemberIds([
        member("ordinary"),
        member("terminal", "Member", true),
        member("admin", "Admin"),
      ]),
    ).toEqual(["ordinary"]);
  });

  it("does not count removed rows toward the 50-account limit", () => {
    const rows = [
      ...Array.from({ length: 50 }, (_, index) => member(`ordinary-${index}`)),
      ...Array.from({ length: 20 }, (_, index) =>
        member(`removed-${index}`, "Member", true),
      ),
    ];
    const selectable = getSelectableFormerMemberIds(rows);
    expect(selectable).toHaveLength(50);
    const selected = toggleVisibleFormerMemberSelection(new Set(), selectable);
    expect(selected.ok && selected.selectedIds.size).toBe(50);
  });

  it("adds and removes one account without mutating the input set", () => {
    const current = new Set(["one"]);
    const added = updateFormerMemberSelection(current, "two", true);
    expect(added.ok && [...added.selectedIds]).toEqual(["one", "two"]);
    expect([...current]).toEqual(["one"]);
    const removed = updateFormerMemberSelection(
      added.selectedIds,
      "one",
      false,
    );
    expect(removed.ok && [...removed.selectedIds]).toEqual(["two"]);
  });

  it("selects and clears exactly the currently rendered IDs", () => {
    const current = new Set(["unloaded"]);
    const selected = toggleVisibleFormerMemberSelection(current, [
      "visible-1",
      "visible-2",
    ]);
    expect(selected.ok && [...selected.selectedIds]).toEqual([
      "unloaded",
      "visible-1",
      "visible-2",
    ]);
    const cleared = toggleVisibleFormerMemberSelection(selected.selectedIds, [
      "visible-1",
      "visible-2",
    ]);
    expect(cleared.ok && [...cleared.selectedIds]).toEqual(["unloaded"]);
  });

  it("rejects the entire addition that would exceed 50", () => {
    const current = new Set(
      Array.from({ length: 49 }, (_, index) => `selected-${index}`),
    );
    const result = toggleVisibleFormerMemberSelection(current, [
      "visible-1",
      "visible-2",
    ]);
    expect(result.ok).toBe(false);
    expect([...result.selectedIds]).toEqual([...current]);
    if (!result.ok) expect(result.message).toContain("50");
  });

  it("accepts exactly 50 and rejects an individual 51st", () => {
    const fortyNine = new Set(
      Array.from({ length: 49 }, (_, index) => `selected-${index}`),
    );
    const fifty = updateFormerMemberSelection(fortyNine, "fiftieth", true);
    expect(fifty.ok && fifty.selectedIds.size).toBe(50);
    const fiftyFirst = updateFormerMemberSelection(
      fifty.selectedIds,
      "fifty-first",
      true,
    );
    expect(fiftyFirst.ok).toBe(false);
    expect(fiftyFirst.selectedIds.size).toBe(50);
  });
});

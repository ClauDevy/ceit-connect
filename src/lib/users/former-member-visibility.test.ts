import { describe, expect, it } from "vitest";
import { normalizeLookaheadPage } from "@/lib/list-paging";
import type { Member } from "@/lib/types";
import {
  countRemovedMembers,
  getVisibleMembers,
  isUsersSearchDebouncing,
} from "./former-member-visibility";

function member(id: string, removed = false): Member {
  return {
    id,
    full_name: removed ? "Former member" : `Member ${id}`,
    email: `${id}@example.edu`,
    role: "Member",
    committee_id: "committee-1",
    avatar_url: null,
    is_active: false,
    anonymized_at: removed ? "2026-10-27T12:00:00Z" : null,
  };
}

describe("former-member client visibility", () => {
  it("hides removed loaded rows by default and reveals the same UUID rows", () => {
    const loaded = [member("one"), member("removed", true), member("two")];
    expect(getVisibleMembers(loaded, false).map((item) => item.id)).toEqual([
      "one",
      "two",
    ]);
    expect(getVisibleMembers(loaded, true).map((item) => item.id)).toEqual([
      "one",
      "removed",
      "two",
    ]);
  });

  it("counts removed rows only from the loaded page supplied by paging", () => {
    const rawPage = [
      ...Array.from({ length: 20 }, (_, index) => member(`visible-${index}`)),
      member("removed-lookahead", true),
    ];
    const page = normalizeLookaheadPage(rawPage, 0);
    expect(page.hasMore).toBe(true);
    expect(countRemovedMembers(page.items)).toBe(0);
  });

  it("does not leave a whitespace-only search in the debounce loading state", () => {
    expect(isUsersSearchDebouncing("   ", "")).toBe(false);
    expect(isUsersSearchDebouncing(" member ", "member")).toBe(false);
    expect(isUsersSearchDebouncing("member", "")).toBe(true);
  });
});

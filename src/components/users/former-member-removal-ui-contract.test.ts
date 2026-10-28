import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PREVIEW_TIMEOUT_MS,
  REMOVAL_TIMEOUT_MS,
} from "./former-member-removal-dialog";

const dialog = readFileSync(
  "src/components/users/former-member-removal-dialog.tsx",
  "utf8",
);
const usersTable = readFileSync("src/components/users/users-table.tsx", "utf8");
const desktop = readFileSync("src/components/users/members-table.tsx", "utf8");
const phone = readFileSync("src/components/users/members-cards.tsx", "utf8");

describe("former-member removal UI contract", () => {
  it("uses the approved preview and removal timeouts with abort signals", () => {
    expect(PREVIEW_TIMEOUT_MS).toBe(20_000);
    expect(REMOVAL_TIMEOUT_MS).toBe(65_000);
    expect(dialog.match(/new AbortController\(\)/g)).toHaveLength(2);
    expect(dialog.match(/signal: controller\.signal/g)).toHaveLength(2);
    expect(dialog.match(/finally/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("freezes a keyed UUID request and sends preview before removal", () => {
    expect(usersTable).toContain("removalRequestKey.current += 1");
    expect(usersTable).toContain("userIds: [...userIds]");
    expect(dialog).toContain('action: "preview"');
    expect(dialog).toContain('action: "remove"');
    expect(dialog).toMatch(
      /expectedFormerMemberConfirmation\(\s*snapshot\.length,?\s*\)/,
    );
  });

  it("re-previews only failed and cleanup-pending results", () => {
    expect(dialog).toContain(
      'result.state === "failed" || result.state === "cleanup-pending"',
    );
    expect(dialog).toContain("onStartRetry(incompleteIds)");
    expect(dialog).not.toContain("setInterval");
  });

  it("handles unknown outcomes without claiming per-user failure", () => {
    expect(dialog).toContain("Outcome unknown");
    expect(dialog).toContain("await onRefresh()");
    expect(dialog).toContain("onShowRemovedMembers");
    expect(dialog).toContain("showRemovedBusy || refreshInFlight");
    expect(usersTable).toContain("setShowRemovedMembers(true)");
    expect(usersTable).toContain("if (!refreshed) return false");
  });

  it("keeps desktop and phone selection role-aware and motion-safe", () => {
    for (const source of [desktop, phone]) {
      expect(source).toContain('member.role === "Admin"');
      expect(source).toContain("motion-control-pop");
      expect(source).toContain("selectedIds.has(member.id)");
    }
    expect(usersTable).toContain(
      'viewerRole === "Admin" && status === "deactivated"',
    );
    expect(usersTable).toContain(
      "getSelectableFormerMemberIds(displayedMembers)",
    );
    expect(usersTable).toContain("member.anonymized_at !== null");
    expect(usersTable).toContain("useListReveal");
    expect(usersTable).toContain("<TabPanel");
  });

  it("keeps retry actions on the frozen result snapshot when rows are hidden", () => {
    expect(dialog).toContain("const [results, setResults]");
    expect(dialog).toContain("results.map((result, index)");
    expect(dialog).toContain("onStartRetry([result.userId])");
    expect(dialog).toContain("onStartRetry(incompleteIds)");
    expect(dialog).not.toContain("displayedMembers");
  });

  it("adds the cleanup helper only to row-level re-runs", () => {
    expect(dialog).toContain('request?.origin === "rerun-cleanup"');
    expect(dialog).toContain(
      "This re-runs Auth, Google sign-in, and photo cleanup",
    );
    expect(dialog).toContain("Retry cleanup");
    expect(dialog).toContain("Retry incomplete");
  });

  it("uses shared primitives and no one-off animation timer", () => {
    expect(dialog).toContain('from "@/components/ui/dialog"');
    expect(dialog).toContain('from "@/components/ui/input"');
    expect(dialog).toContain('from "@/components/ui/button"');
    expect(dialog).toContain('from "@/components/ui/badge"');
    expect(dialog).toContain('from "@/components/ui/inline-alert"');
    expect(dialog).not.toMatch(/setTimeout\([^,]+,\s*(220|260|300)\)/);
  });
});

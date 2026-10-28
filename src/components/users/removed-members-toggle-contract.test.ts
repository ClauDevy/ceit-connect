import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const usersTable = readFileSync("src/components/users/users-table.tsx", "utf8");
const desktop = readFileSync("src/components/users/members-table.tsx", "utf8");
const phone = readFileSync("src/components/users/members-cards.tsx", "utf8");
const actions = readFileSync("src/components/users/member-actions.tsx", "utf8");
const status = readFileSync(
  "src/components/users/member-status-badge.tsx",
  "utf8",
);

describe("removed-member roster UI contract", () => {
  it("defaults to hidden and keeps the client-only toggle across tab and search changes", () => {
    expect(usersTable).toContain("useState(false)");
    expect(usersTable).toContain("Show removed members");
    expect(usersTable).toContain("checked={showRemovedMembers}");
    expect(usersTable).toContain("setShowRemovedMembers(event.target.checked)");
    expect(usersTable).not.toContain("setShowRemovedMembers(false)");
  });

  it("uses one keyboard-operable labeled checkbox with visible focus styling", () => {
    expect(usersTable).toMatch(
      /<label className="[^"]*focus-within:ring-3[^"]*">[\s\S]*checked=\{showRemovedMembers\}[\s\S]*Show removed members[\s\S]*<\/label>/,
    );
    expect(usersTable.match(/aria-live="polite"/g)).toHaveLength(1);
  });

  it("counts and filters loaded rows while retaining Load more and the all-hidden state", () => {
    expect(usersTable).toContain("countRemovedMembers(loadedMembers)");
    expect(usersTable).toContain("getVisibleMembers(loadedMembers, false)");
    expect(usersTable).toContain("removed hidden");
    expect(usersTable).toContain("All loaded members are removed");
    expect(usersTable).toContain("<LoadMoreControl");
  });

  it("shows removed identity without the retired cleanup text", () => {
    for (const source of [desktop, phone]) {
      expect(source).toContain('member.anonymized_at ? "Former member"');
      expect(source).not.toContain("Cleanup may be retried");
    }
    expect(status).toContain(">Removed</Badge>");
    expect(actions).toContain("Re-run cleanup");
    expect(actions).toContain('if (viewerRole === "Co-Admin") return null');
  });

  it("does not render a checkbox for removed rows on desktop or phone", () => {
    for (const source of [desktop, phone]) {
      expect(source).toContain("member.anonymized_at === null");
    }
  });
});

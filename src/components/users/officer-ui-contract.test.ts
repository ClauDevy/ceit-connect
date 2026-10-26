import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const inviteDialog = readFileSync(
  "src/components/users/invite-officers-dialog.tsx",
  "utf8",
);
const usersTable = readFileSync("src/components/users/users-table.tsx", "utf8");
const pending = readFileSync(
  "src/components/users/pending-officer-invites.tsx",
  "utf8",
);

describe("officer UI contract", () => {
  it("keeps explicit retry, persistent results, and unfinished-close confirmation", () => {
    expect(inviteDialog).toContain('"Retry unsent"');
    expect(inviteDialog).toContain("setRows((current) =>");
    expect(inviteDialog).toContain("Close with unfinished invitations?");
    expect(inviteDialog).toContain("rows.length === 1");
    expect(inviteDialog).toContain("rows.length >= 10");
    expect(inviteDialog).not.toContain("setTimeout");
  });

  it("uses shared motion with a reduced-motion-safe interaction contract", () => {
    expect(inviteDialog).toContain("MotionPresence");
    expect(inviteDialog).toContain("Collapse");
    expect(inviteDialog).toContain("motion-card-interaction");
    expect(inviteDialog).toContain("motion-reduce:");
  });

  it("links pending invitations by Auth id without changing paging inputs", () => {
    expect(usersTable).toContain("pendingInviteByAuthUserId");
    expect(usersTable).toContain("item.auth_user_id === cancelInviteTarget.id");
    expect(pending).toContain("visibleAuthUserIds.has(invite.auth_user_id)");
    expect(usersTable).toContain("useOffsetListPaging");
  });

  it("refreshes the shell and leaves Users after self step-down", () => {
    expect(usersTable).toContain('router.replace("/home")');
    expect(usersTable).toContain("router.refresh()");
  });

  it("keeps phone targets and semantic interaction states", () => {
    expect(inviteDialog).toContain("size-11 md:size-9");
    expect(pending).toContain("focus-visible:ring-3");
    expect(pending).toContain("active:bg-accent/80");
    expect(inviteDialog).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

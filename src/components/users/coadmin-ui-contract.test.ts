import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const usersTable = readFileSync("src/components/users/users-table.tsx", "utf8");
const actions = readFileSync("src/components/users/member-actions.tsx", "utf8");
const inviteForm = readFileSync("src/components/users/invite-user-form.tsx", "utf8");
const editDialog = readFileSync(
  "src/components/users/edit-member-name-dialog.tsx",
  "utf8",
);

describe("Co-Admin Users UI contract", () => {
  it("does not send role or committee authority from the Co-Admin invite form", () => {
    expect(inviteForm).not.toContain('role: "Member"');
    expect(inviteForm).toContain('? { email, fullName, committeeId }');
    expect(inviteForm).toContain(': { email, fullName }');
    expect(inviteForm).toContain('value={committeeName ?? "No committee assigned"}');
    expect(inviteForm).toContain("readOnly");
  });

  it("keeps officer and pending-invite UI behind the Admin role", () => {
    expect(usersTable).toContain('viewerRole === "Admin"');
    expect(usersTable).toContain("<PendingOfficerInvites");
    expect(usersTable).toContain("<OfficerTransitionDialog");
    expect(actions).toContain('viewerRole === "Co-Admin"');
    expect(actions).toContain("Edit name");
  });

  it("uses the RPC-returned trimmed name in the visible row", () => {
    expect(editDialog).toContain('(body as { fullName: string }).fullName');
    expect(usersTable).toContain("[editTarget.id]: fullName");
  });

  it("uses shared motion and retains a reduced-motion-safe action row", () => {
    expect(usersTable).toContain("useListReveal");
    expect(usersTable).toContain("<TabPanel");
    expect(actions).toContain("motion-reduce:transition-none");
    expect(editDialog).not.toContain("setTimeout");
  });
});

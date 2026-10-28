import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ComponentProps<"button">) => (
    <button {...props}>{children}</button>
  ),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuTrigger: ({
    children,
    ...props
  }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
  DropdownMenuContent: ({
    children,
    ...props
  }: React.ComponentProps<"div">) => <div {...props}>{children}</div>,
  DropdownMenuItem: ({
    children,
    ...props
  }: React.ComponentProps<"button">) => <button {...props}>{children}</button>,
}));

import { MemberAction } from "./member-actions";
import type { Member } from "../../lib/types";

const activeMember: Member = {
  id: "member-1",
  full_name: "Ari Santos",
  email: "ari@example.edu",
  role: "Member",
  committee_id: "committee-1",
  avatar_url: null,
  is_active: true,
  anonymized_at: null,
};

describe("MemberAction", () => {
  it("puts an authorized active member's Deactivate action in a menu", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        viewerRole="Admin"
        member={activeMember}
        isSelf={false}
        pending={false}
        onAction={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="More actions for Ari Santos"');
    expect(html).toContain("Deactivate");
    expect(html).not.toContain("Reactivate");
  });

  it("groups Reactivate and Remove former member in the row menu", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        viewerRole="Admin"
        member={{ ...activeMember, is_active: false }}
        isSelf={false}
        pending={false}
        onAction={vi.fn()}
      />,
    );

    expect(html).toContain("Reactivate");
    expect(html).toContain("More actions");
    expect(html).toContain("Remove former member");
    expect(html).not.toContain("Deactivate");
  });

  it("gives an Admin only Re-run cleanup for an anonymized row", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        viewerRole="Admin"
        member={{
          ...activeMember,
          full_name: "Former member",
          is_active: false,
          anonymized_at: "2026-10-27T12:00:00Z",
        }}
        isSelf={false}
        pending={false}
        onAction={vi.fn()}
      />,
    );
    expect(html).toContain("Re-run cleanup");
    expect(html).not.toContain("Reactivate");
    expect(html).not.toContain("Edit name");
  });

  it("gives a Co-Admin no actions for an anonymized row", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        viewerRole="Co-Admin"
        member={{
          ...activeMember,
          full_name: "Former member",
          is_active: false,
          anonymized_at: "2026-10-27T12:00:00Z",
        }}
        isSelf={false}
        pending={false}
        onAction={vi.fn()}
      />,
    );
    expect(html).toBe("");
  });

  it("gives the current Admin only the self step-down action", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        viewerRole="Admin"
        member={{ ...activeMember, role: "Admin", committee_id: null }}
        isSelf
        pending={false}
        onAction={vi.fn()}
      />,
    );

    expect(html).toContain("Step down to Member");
    expect(html).not.toContain("Deactivate");
    expect(html).not.toContain("Reactivate");
  });

  it("shows only Cancel invitation for an unaccepted officer", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        viewerRole="Admin"
        member={{ ...activeMember, role: "Co-Admin" }}
        isSelf={false}
        pending={false}
        pendingInvite={{
          id: "invite-1",
          auth_user_id: activeMember.id,
          email: activeMember.email,
          full_name: activeMember.full_name,
          officer_role: "Co-Admin",
          committee_id: activeMember.committee_id,
          status: "sent",
          created_at: "2026-10-26T00:00:00Z",
          cleanup_pending: false,
        }}
        onAction={vi.fn()}
      />,
    );
    expect(html).toContain("Cancel invitation");
    expect(html).not.toContain("Deactivate");
    expect(html).not.toContain("Return to Member");
  });

  it("gives a Co-Admin only edit and deactivate for an active Member", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        viewerRole="Co-Admin"
        member={activeMember}
        isSelf={false}
        pending={false}
        onAction={vi.fn()}
      />,
    );
    expect(html).toContain("Edit name");
    expect(html).toContain("Deactivate");
    expect(html).not.toContain("Appoint as officer");
    expect(html).not.toContain("Move committee");
    expect(html).not.toContain("Cancel invitation");
  });

  it("gives a Co-Admin only edit and reactivate for a deactivated Member", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        viewerRole="Co-Admin"
        member={{ ...activeMember, is_active: false }}
        isSelf={false}
        pending={false}
        onAction={vi.fn()}
      />,
    );
    expect(html).toContain("Edit name");
    expect(html).toContain("Reactivate");
    expect(html).not.toContain("Deactivate");
  });
});

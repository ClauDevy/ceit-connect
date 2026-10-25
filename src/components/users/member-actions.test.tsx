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
};

describe("MemberAction", () => {
  it("puts an authorized active member's Deactivate action in a menu", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        member={activeMember}
        isSelf={false}
        pending={false}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="More actions for Ari Santos"');
    expect(html).toContain("Deactivate");
    expect(html).not.toContain("Reactivate");
  });

  it("keeps Reactivate direct and does not render a menu trigger", () => {
    const html = renderToStaticMarkup(
      <MemberAction
        member={{ ...activeMember, is_active: false }}
        isSelf={false}
        pending={false}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("Reactivate");
    expect(html).not.toContain("More actions");
    expect(html).not.toContain("Deactivate");
  });

  it('renders only "You" for the current user with no action menu', () => {
    const html = renderToStaticMarkup(
      <MemberAction
        member={activeMember}
        isSelf
        pending={false}
        onToggle={vi.fn()}
      />,
    );

    expect(html).toContain("You");
    expect(html).not.toContain("More actions");
    expect(html).not.toContain("Deactivate");
    expect(html).not.toContain("Reactivate");
  });
});

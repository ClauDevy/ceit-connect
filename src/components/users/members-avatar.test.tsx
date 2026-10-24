import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/user-avatar", () => ({
  UserAvatar: ({ name, src }: { name: string; src?: string | null }) =>
    src ? <span data-avatar-src={src}>{name}</span> : <span>{name}</span>,
}));
vi.mock("@/components/users/member-actions", () => ({
  MemberAction: () => <button type="button">Action</button>,
}));
vi.mock("@/components/users/member-status-badge", () => ({
  MemberStatusBadge: () => <span>Status</span>,
}));
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

import { MembersCards } from "./members-cards";
import { MembersTable } from "./members-table";
import type { Member } from "../../lib/types";

const member: Member = {
  id: "member-1",
  full_name: "Ari Santos",
  email: "ari@example.edu",
  role: "Member",
  committee_id: "committee-1",
  avatar_url: "https://storage.example/member-1/avatar.webp?v=updated",
  is_active: true,
};

const props = {
  members: [member],
  committeeName: () => "Documentation",
  currentUserId: "admin-1",
  pendingId: null,
  onToggle: vi.fn(),
};

describe("User Management avatar markup", () => {
  it("passes avatar_url to the desktop UserAvatar", () => {
    const html = renderToStaticMarkup(<MembersTable {...props} />);
    expect(html).toContain(
      'data-avatar-src="https://storage.example/member-1/avatar.webp?v=updated"',
    );
  });

  it("passes avatar_url to the mobile UserAvatar", () => {
    const html = renderToStaticMarkup(<MembersCards {...props} />);
    expect(html).toContain(
      'data-avatar-src="https://storage.example/member-1/avatar.webp?v=updated"',
    );
  });
});

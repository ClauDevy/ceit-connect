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
  Table: ({ children, ...props }: React.ComponentProps<"table">) => <table {...props}>{children}</table>,
  TableBody: ({ children, ...props }: React.ComponentProps<"tbody">) => <tbody {...props}>{children}</tbody>,
  TableCell: ({ children, ...props }: React.ComponentProps<"td">) => <td {...props}>{children}</td>,
  TableHead: ({ children, ...props }: React.ComponentProps<"th">) => <th {...props}>{children}</th>,
  TableHeader: ({ children, ...props }: React.ComponentProps<"thead">) => <thead {...props}>{children}</thead>,
  TableRow: ({ children, ...props }: React.ComponentProps<"tr">) => <tr {...props}>{children}</tr>,
}));
vi.mock("@/lib/utils", () => ({
  cn: (...values: Array<string | false | undefined>) =>
    values.filter(Boolean).join(" "),
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
  onAction: vi.fn(),
  pendingInviteByAuthUserId: new Map(),
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

  it("uses the same stable reveal ids for both roster presentations", () => {
    const members = Array.from({ length: 21 }, (_, index) => ({
      ...member,
      id: `member-${index + 1}`,
      full_name: `Member ${index + 1}`,
      email: `member-${index + 1}@example.edu`,
    }));
    const motionProps = {
      ...props,
      members,
      getRevealProps: (id: string) => ({
        "data-motion-reveal-id": id,
        ref: () => undefined,
      }),
    };

    expect(
      renderToStaticMarkup(<MembersTable {...motionProps} />).match(
        /data-motion-reveal-id=/g,
      ),
    ).toHaveLength(21);
    expect(
      renderToStaticMarkup(<MembersCards {...motionProps} />).match(
        /data-motion-reveal-id=/g,
      ),
    ).toHaveLength(21);
  });
});

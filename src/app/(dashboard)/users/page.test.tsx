import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
  requireUser: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  createClient: vi.fn(),
  listUsersPage: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/users/list-users", () => ({ listUsersPage: mocks.listUsersPage }));
vi.mock("@/lib/list-paging", () => ({
  normalizeLookaheadPage: (rows: unknown[], offset: number) => ({
    items: rows.slice(0, 20),
    hasMore: rows.length > 20,
    offset,
  }),
}));
vi.mock("@/components/users/invite-user-dialog", () => ({
  InviteUserDialog: ({ viewerRole, committeeName }: { viewerRole: string; committeeName: string | null }) => (
    <div data-invite-user={`${viewerRole}:${committeeName ?? "none"}`} />
  ),
}));
vi.mock("@/components/users/invite-officers-dialog", () => ({
  InviteOfficersDialog: () => <div data-invite-officers />,
}));
vi.mock("@/components/shared/page-header", () => ({
  PageHeader: ({ actions }: { actions?: React.ReactNode }) => <>{actions}</>,
}));
vi.mock("@/components/users/users-table", () => ({
  UsersTable: ({ viewerRole }: { viewerRole: string }) => (
    <div data-users-table={viewerRole} />
  ),
}));
vi.mock("@/components/ui/inline-alert", () => ({
  InlineAlert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

import UsersPage from "./page";

const committee = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "CIA",
};

function dataClient() {
  const order = vi.fn().mockResolvedValue({ data: [committee], error: null });
  const select = vi.fn(() => ({ order }));
  const from = vi.fn(() => ({ select }));
  const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
  const client = { from, rpc };
  mocks.createClient.mockResolvedValue(client);
  return { client, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "caller" });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Admin",
    committee_id: null,
    is_active: true,
  });
  mocks.listUsersPage.mockResolvedValue({ data: [], error: null });
  dataClient();
});

describe("Users page guard and role surfaces", () => {
  it("redirects signed-out and disallowed callers before data access", async () => {
    mocks.requireUser.mockRejectedValueOnce(new Error("REDIRECT:/login"));
    await expect(UsersPage()).rejects.toThrow("REDIRECT:/login");
    mocks.requireUser.mockResolvedValue({ id: "caller" });
    mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
    await expect(UsersPage()).rejects.toThrow("REDIRECT:/home");
    expect(mocks.getActiveProfileForRoles).toHaveBeenLastCalledWith([
      "Admin",
      "Co-Admin",
    ]);
  });

  it("keeps the Admin list and officer UI unchanged", async () => {
    const { rpc } = dataClient();
    const html = renderToStaticMarkup(await UsersPage());
    expect(mocks.listUsersPage).toHaveBeenCalledWith(expect.anything(), {
      offset: 0,
      search: "",
      status: "active",
    });
    expect(rpc).toHaveBeenCalledWith("list_pending_officer_invites");
    expect(html).toContain("data-invite-officers");
    expect(html).toContain('data-invite-user="Admin:none"');
    expect(html).toContain('data-users-table="Admin"');
  });

  it("loads a Co-Admin surface without pending officer data", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValue({
      role: "Co-Admin",
      committee_id: committee.id,
      is_active: true,
    });
    const { rpc } = dataClient();
    const html = renderToStaticMarkup(await UsersPage());
    expect(rpc).not.toHaveBeenCalled();
    expect(html).not.toContain("data-invite-officers");
    expect(html).toContain('data-invite-user="Co-Admin:CIA"');
    expect(html).toContain('data-users-table="Co-Admin"');
  });

  it("gives a null-committee Co-Admin a safe empty state", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValue({
      role: "Co-Admin",
      committee_id: null,
      is_active: true,
    });
    const html = renderToStaticMarkup(await UsersPage());
    expect(html).toContain("No committee is assigned");
    expect(html).not.toContain("data-invite-user");
    expect(html).not.toContain("data-users-table");
  });

  it("shows a safe error instead of an empty roster when a query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.listUsersPage.mockResolvedValue({
      data: null,
      error: { message: "private database detail" },
    });
    const html = renderToStaticMarkup(await UsersPage());
    expect(html).toContain("User Management could not be loaded");
    expect(html).not.toContain("private database detail");
  });
});

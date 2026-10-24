import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
  requireUser: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/components/users/invite-user-dialog", () => ({
  InviteUserDialog: () => null,
}));
vi.mock("@/components/shared/page-header", () => ({
  PageHeader: () => null,
}));
vi.mock("@/components/users/users-table", () => ({ UsersTable: () => null }));
vi.mock("@/components/ui/inline-alert", () => ({
  InlineAlert: ({ children }: { children: React.ReactNode }) => (
    <div role="alert">{children}</div>
  ),
}));

import UsersPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "admin" });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Admin",
    committee_id: null,
    is_active: true,
  });
});

describe("Users page guard", () => {
  it("redirects a signed-out caller before the active-profile or data queries", async () => {
    mocks.requireUser.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(UsersPage()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.getActiveProfileForRoles).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  for (const caller of ["inactive Admin", "profile-less", "Co-Admin", "Member"]) {
    it(`redirects ${caller} before constructing the data client`, async () => {
      mocks.getActiveProfileForRoles.mockResolvedValue(null);
      await expect(UsersPage()).rejects.toThrow("REDIRECT:/home");
      expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith(["Admin"]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    });
  }

  it("loads page data for an active Admin", async () => {
    const order = vi.fn().mockResolvedValue({ data: [], error: null });
    const select = vi.fn(() => ({ order }));
    mocks.createClient.mockResolvedValue({ from: vi.fn(() => ({ select })) });
    await expect(UsersPage()).resolves.toBeTruthy();
    expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith(["Admin"]);
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledWith(
      "id, full_name, email, role, committee_id, avatar_url, is_active",
    );
  });

  it("shows a safe error instead of an empty roster when a query fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const from = vi.fn((table: string) => ({
      select: vi.fn(() => ({
        order: vi.fn().mockResolvedValue(
          table === "users"
            ? { data: null, error: { message: "private database detail" } }
            : { data: [], error: null },
        ),
      })),
    }));
    mocks.createClient.mockResolvedValue({ from });

    const html = renderToStaticMarkup(await UsersPage());

    expect(html).toContain("User Management could not be loaded");
    expect(html).not.toContain("No members yet");
    expect(html).not.toContain("private database detail");
  });
});

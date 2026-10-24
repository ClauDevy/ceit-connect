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
  });
});

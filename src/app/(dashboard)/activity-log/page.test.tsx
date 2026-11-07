import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
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
vi.mock("@/components/activity-log/activity-log-page", () => ({
  ActivityLogPageClient: () => <div data-activity-log />,
}));

import ActivityLogPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "leader" });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Admin",
    committee_id: null,
    is_active: true,
  });
  const order = vi.fn().mockResolvedValue({ data: [], error: null });
  const select = vi.fn(() => ({ order }));
  mocks.createClient.mockResolvedValue({
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn(() => ({ select })),
  });
});

describe("Activity Log page access", () => {
  it.each(["Member", "inactive Admin"])(
    "does not load activity for a %s",
    async () => {
      mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);
      await expect(ActivityLogPage()).rejects.toThrow("REDIRECT:/home");
      expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith([
        "Admin",
        "Co-Admin",
      ]);
      expect(mocks.createClient).not.toHaveBeenCalled();
    },
  );
});

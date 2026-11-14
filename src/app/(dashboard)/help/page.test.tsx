import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HelpManualPayload } from "@/lib/help-manual";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string): never => {
    throw new Error(`REDIRECT:${path}`);
  }),
  requireUser: vi.fn(),
  getActiveProfileForRoles: vi.fn(),
  manual: undefined as HelpManualPayload | undefined,
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth", () => ({
  requireUser: mocks.requireUser,
  getActiveProfileForRoles: mocks.getActiveProfileForRoles,
}));
vi.mock("@/components/help/help-manual", () => ({
  HelpManual: ({ manual }: { manual: HelpManualPayload }) => {
    mocks.manual = manual;
    return <div data-help-role={manual.viewerRole} />;
  },
}));

import HelpPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.manual = undefined;
  mocks.requireUser.mockResolvedValue({ id: "viewer" });
  mocks.getActiveProfileForRoles.mockResolvedValue({
    role: "Admin",
    committee_id: null,
    is_active: true,
  });
});

describe("Help page role boundary", () => {
  it("guards the page for an active supported role", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValueOnce(null);

    await expect(HelpPage()).rejects.toThrow("REDIRECT:/home");
    expect(mocks.getActiveProfileForRoles).toHaveBeenCalledWith([
      "Admin",
      "Co-Admin",
      "Member",
    ]);
  });

  it("filters leadership sections and FAQs out before a Member payload reaches the client", async () => {
    mocks.getActiveProfileForRoles.mockResolvedValueOnce({
      role: "Member",
      committee_id: "committee-a",
      is_active: true,
    });

    const html = renderToStaticMarkup(await HelpPage());
    const payload = mocks.manual;

    expect(html).toContain('data-help-role="Member"');
    expect(payload).toBeDefined();
    expect(payload?.sections.map((section) => section.id)).not.toContain("leadership");
    expect(payload?.faqs.map((faq) => faq.id)).not.toContain("activity-retention");
    expect(payload?.faqs.map((faq) => faq.id)).not.toContain("president-committee");
    expect(JSON.stringify(payload)).not.toContain("Co-Admin and Admin only");
    expect(JSON.stringify(payload)).not.toContain("Who can be newly assigned to the President committee?");
  });

  it("includes leadership guidance for an Admin", async () => {
    renderToStaticMarkup(await HelpPage());

    expect(mocks.manual?.sections.map((section) => section.id)).toContain("leadership");
    expect(mocks.manual?.faqs.map((faq) => faq.id)).toContain("president-committee");
  });
});

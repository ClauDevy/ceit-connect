// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@/components/shared/motion", () => ({
  Collapse: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  SectionEnter: ({ children, ...props }: React.HTMLAttributes<HTMLElement>) =>
    <section {...props}>{children}</section>,
}));

import { HelpManual } from "@/components/help/help-manual";
import { getHelpManualForRole } from "@/lib/help-manual";

const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockReset();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
});

afterEach(cleanup);

describe("Help manual interactions", () => {
  it("opens only Quick start on the mobile accordion initially", () => {
    render(<HelpManual manual={getHelpManualForRole("Member")} />);

    expect(screen.getByRole("button", { name: /Quick start/i }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: /Your tasks/i }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: /FAQ & troubleshooting/i }).getAttribute("aria-expanded")).toBe("false");
  });

  it("opens a jump target before scrolling to its sticky-header offset anchor", async () => {
    render(<HelpManual manual={getHelpManualForRole("Member")} />);

    fireEvent.click(screen.getAllByRole("link", { name: "Notifications" })[0]);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Notifications\b/i }).getAttribute("aria-expanded")).toBe("true");
      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
      expect(document.activeElement).toBe(document.getElementById("notifications"));
    });
    expect(document.getElementById("notifications")?.className).toContain("scroll-mt-24");
  });

  it("searches only allowed FAQs without case sensitivity and opens the result", async () => {
    render(<HelpManual manual={getHelpManualForRole("Admin")} />);

    fireEvent.change(screen.getAllByLabelText("Search questions")[0], {
      target: { value: "ACTIVITY LOG" },
    });

    await waitFor(() => {
      const matches = screen.getAllByRole("button", { name: "How long does the Activity Log keep entries?" });
      expect(matches.every((button) => button.getAttribute("aria-expanded") === "true")).toBe(true);
      expect(screen.getByRole("button", { name: /FAQ & troubleshooting/i }).getAttribute("aria-expanded")).toBe("true");
      expect(scrollIntoView).toHaveBeenCalled();
    });
  });

  it("shows a clear empty state and never exposes leadership FAQs to a Member search", () => {
    render(<HelpManual manual={getHelpManualForRole("Member")} />);

    expect(screen.queryByText("Who can be newly assigned to the President committee?")).toBeNull();
    fireEvent.change(screen.getAllByLabelText("Search questions")[0], {
      target: { value: "PRESIDENT COMMITTEE" },
    });

    expect(screen.getAllByText("No FAQ results").length).toBeGreaterThan(0);
    expect(screen.queryByText("Who can be newly assigned to the President committee?")).toBeNull();
  });
});

describe("Help manual copy boundaries", () => {
  it("uses the approved President rule and keeps unverified rollout details off screen", () => {
    const adminCopy = JSON.stringify(getHelpManualForRole("Admin"));

    expect(adminCopy).toContain("Only Admins can be newly assigned. Existing assignments stay unchanged.");
    expect(adminCopy).not.toMatch(/Manila|Asia\/|timezone/i);
    expect(adminCopy).not.toMatch(/grandfathered Member|rename risk/i);
  });
});

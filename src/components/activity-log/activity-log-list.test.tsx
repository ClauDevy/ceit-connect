import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/motion", () => ({
  useReducedMotionPreference: () => true,
  useListReveal: () => ({ getRevealProps: () => ({}) }),
}));

import { ActivityLogList } from "./activity-log-list";

describe("ActivityLogList", () => {
  it("renders an automatic archive with the System actor", () => {
    const html = renderToStaticMarkup(
      <ActivityLogList
        mode="global"
        settled
        rows={[{
          activityId: "01890f3e-7b2c-7cc1-9234-0123456789ab",
          activityCreatedAt: "2026-11-08T00:05:00+08:00",
          action: "UPDATE",
          taskId: null,
          taskTitle: "Event archived automatically",
          eventName: "Council Event",
          committeeId: null,
          committeeName: null,
          actorName: "System",
          changeSummary: ["Event archived automatically"],
          isMasked: false,
        }]}
      />,
    );
    expect(html).toContain("Event archived automatically");
    expect(html).toContain("System");
  });
});

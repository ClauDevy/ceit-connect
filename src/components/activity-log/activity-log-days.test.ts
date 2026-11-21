import { describe, expect, it } from "vitest";
import { activityDayHeading, groupActivityByDay, manilaDayKey } from "./activity-log-days";

const now = new Date("2026-11-20T04:50:00Z"); // Fri Nov 20, 12:50 in Manila

describe("activity day grouping", () => {
  it("uses the Manila calendar day, not the UTC day", () => {
    // 17:30 UTC on Nov 19 is already 01:30 on Nov 20 in Manila.
    expect(manilaDayKey("2026-11-19T17:30:00Z")).toBe("2026-11-20");
    expect(manilaDayKey("2026-11-19T15:30:00Z")).toBe("2026-11-19");
  });

  it("labels Today, Yesterday and older days", () => {
    expect(activityDayHeading("2026-11-20", now).title).toBe("Today");
    expect(activityDayHeading("2026-11-19", now).title).toBe("Yesterday");
    expect(activityDayHeading("2026-11-12", now)).toEqual({
      title: "Thu, Nov 12",
      subtitle: null,
    });
    expect(activityDayHeading("2025-12-31", now).title).toContain("2025");
  });

  it("keeps the incoming order and splits on day changes", () => {
    const rows = [
      { id: "a", activityCreatedAt: "2026-11-20T03:00:00Z" },
      { id: "b", activityCreatedAt: "2026-11-20T01:00:00Z" },
      { id: "c", activityCreatedAt: "2026-11-19T03:00:00Z" },
    ];
    const groups = groupActivityByDay(rows, now);
    expect(groups.map((group) => group.rows.map((row) => row.id))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect(groups.map((group) => group.heading.title)).toEqual(["Today", "Yesterday"]);
  });
});

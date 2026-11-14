import { describe, expect, it } from "vitest";
import { getAppCalendarDate } from "./timezone";

describe("application calendar date", () => {
  it("changes dates at the Asia/Manila midnight boundary", () => {
    expect(getAppCalendarDate(new Date("2026-11-13T15:59:59.999Z"))).toBe(
      "2026-11-13",
    );
    expect(getAppCalendarDate(new Date("2026-11-13T16:00:00.000Z"))).toBe(
      "2026-11-14",
    );
  });

  it("keeps a due date stored at 00:00 UTC on its intended calendar date", () => {
    expect(getAppCalendarDate(new Date("2026-11-14T00:00:00.000Z"))).toBe(
      "2026-11-14",
    );
  });
});

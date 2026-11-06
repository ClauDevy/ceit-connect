import { describe, expect, it } from "vitest";
import { formatDateSafe, formatDueLabel } from "./safe-date";

const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

describe("safe date formatting", () => {
  it("formats readable dates", () => {
    expect(formatDateSafe(formatter, "2026-10-18")).toBe("Oct 18");
    expect(formatDueLabel(formatter, "2026-10-18")).toBe("Due Oct 18");
  });

  it("never throws on unreadable dates", () => {
    expect(formatDateSafe(formatter, "2026600-10-18")).toBe("Date unavailable");
    expect(formatDueLabel(formatter, "2026600-10-18")).toBe("Due date unavailable");
    expect(formatDueLabel(formatter, null)).toBe("No deadline");
  });
});

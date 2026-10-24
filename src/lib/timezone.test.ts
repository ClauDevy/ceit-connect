import { describe, expect, it } from "vitest";
import { APP_TIME_ZONE, splitAppTimestamp, toAppTimestamp } from "./timezone";

describe("Philippine-time helpers", () => {
  it("uses the single Asia/Manila application contract", () => {
    expect(APP_TIME_ZONE).toEqual({
      iana: "Asia/Manila",
      utcOffset: "+08:00",
    });
  });

  it("serializes local Philippine date and time without browser-timezone input", () => {
    expect(toAppTimestamp("2026-10-24", "00:30")).toBe(
      "2026-10-23T16:30:00.000Z",
    );
  });

  it("splits a stored timestamp back into Philippine date and time", () => {
    expect(splitAppTimestamp("2026-10-23T16:30:00.000Z")).toEqual({
      date: "2026-10-24",
      time: "00:30",
    });
  });

  it("fails safely for an invalid timestamp", () => {
    expect(splitAppTimestamp("not-a-timestamp")).toBeNull();
  });
});

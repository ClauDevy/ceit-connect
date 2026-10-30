import { describe, expect, it } from "vitest";
import { getEventSaveErrorMessage } from "./save-error";

describe("getEventSaveErrorMessage", () => {
  it("maps the Draft cap to fixed copy without echoing database values", () => {
    const message = getEventSaveErrorMessage({
      code: "CCD01",
      message: "creator 123 has 11 drafts",
    });
    expect(message).toBe(
      "This creator already has 10 Draft events. Launch, archive, or delete a Draft before saving another.",
    );
    expect(message).not.toContain("123");
  });

  it("maps a dependency-lock deadlock to a retryable save message", () => {
    expect(
      getEventSaveErrorMessage({
        code: "40P01",
        message: "deadlock detected",
      }),
    ).toBe(
      "Another task change happened at the same time. Please try saving again.",
    );
  });

  it("maps the event task cap to fixed copy without echoing database values", () => {
    const message = getEventSaveErrorMessage({
      code: "CCP01",
      message: "event 123 exceeded a stored count",
    });
    expect(message).toBe(
      "This event already has the maximum of 200 tasks.",
    );
    expect(message).not.toContain("123");
  });

  it("preserves other database messages", () => {
    expect(
      getEventSaveErrorMessage({
        code: "23505",
        message: "A database validation failed.",
      }),
    ).toBe("A database validation failed.");
  });
});

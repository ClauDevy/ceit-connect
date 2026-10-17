import { describe, expect, it } from "vitest";
import { getEventSaveErrorMessage } from "./save-error";

describe("getEventSaveErrorMessage", () => {
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

  it("preserves other database messages", () => {
    expect(
      getEventSaveErrorMessage({
        code: "23505",
        message: "A database validation failed.",
      }),
    ).toBe("A database validation failed.");
  });
});

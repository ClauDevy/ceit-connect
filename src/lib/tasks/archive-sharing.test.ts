import { describe, expect, it } from "vitest";
import {
  getArchivedTaskShareErrorMessage,
  isArchivedTaskShareControl,
  isArchivedTaskShareRetryableError,
  isArchivedTaskShareUnavailableError,
  normalizeArchivedTaskViewerSearch,
} from "./archive-sharing";

describe("archived task sharing", () => {
  it("validates the exact share-control reader shape", () => {
    expect(
      isArchivedTaskShareControl({
        out_id: "user-1",
        out_full_name: "Archive Viewer",
        out_avatar_url: null,
        out_is_archive_only: false,
      }),
    ).toBe(true);
    expect(
      isArchivedTaskShareControl({
        out_id: "user-1",
        out_full_name: "Archive Viewer",
        out_avatar_url: "https://example.com/avatar.webp",
        out_is_archive_only: true,
      }),
    ).toBe(true);
    expect(
      isArchivedTaskShareControl({
        id: "user-1",
        out_full_name: "Archive Viewer",
        out_avatar_url: null,
        out_is_archive_only: false,
      }),
    ).toBe(false);
    expect(
      isArchivedTaskShareControl({
        out_id: "user-1",
        out_full_name: "Archive Viewer",
        out_avatar_url: null,
        out_is_archive_only: "false",
      }),
    ).toBe(false);
  });

  it("trims and validates the server-backed search", () => {
    expect(normalizeArchivedTaskViewerSearch("  Claude  ")).toEqual({
      ok: true,
      value: "Claude",
    });
    expect(normalizeArchivedTaskViewerSearch("   ")).toEqual({
      ok: true,
      value: null,
    });
    expect(normalizeArchivedTaskViewerSearch("x".repeat(100))).toEqual({
      ok: true,
      value: "x".repeat(100),
    });
    expect(normalizeArchivedTaskViewerSearch(` ${"x".repeat(101)} `)).toEqual({
      ok: false,
      message: "Search must be 100 characters or fewer.",
    });
  });

  it("maps every database code without exposing raw messages", () => {
    const expected = new Map([
      ["CCS01", "You can no longer manage access for this task."],
      ["CCS02", "Archive-only sharing is no longer available for this task."],
      ["CCS03", "The selected active user is no longer available."],
      ["CCS04", "This person already has full access to the task."],
      ["CCS05", "This archive-only share no longer exists."],
      ["CCS06", "Search must be 100 characters or fewer."],
      [
        "40001",
        "Access changed while saving. The page was refreshed; please try again.",
      ],
      [
        "40P01",
        "Access is busy right now. The page was refreshed; please try again.",
      ],
    ]);

    for (const [code, message] of expected) {
      expect(
        getArchivedTaskShareErrorMessage(
          { code, message: "sensitive database detail" },
          "grant",
        ),
      ).toBe(message);
    }

    expect(
      getArchivedTaskShareErrorMessage(
        { code: "UNKNOWN", message: "sensitive database detail" },
        "revoke",
      ),
    ).toBe("Access could not be revoked. Please try again.");
  });

  it("classifies retryable and unavailable failures", () => {
    expect(isArchivedTaskShareRetryableError({ code: "40001" })).toBe(true);
    expect(isArchivedTaskShareRetryableError({ code: "40P01" })).toBe(true);
    expect(isArchivedTaskShareRetryableError({ code: "CCS04" })).toBe(false);
    expect(isArchivedTaskShareUnavailableError({ code: "CCS01" })).toBe(true);
    expect(isArchivedTaskShareUnavailableError({ code: "CCS02" })).toBe(true);
    expect(isArchivedTaskShareUnavailableError({ code: "CCS03" })).toBe(false);
  });
});

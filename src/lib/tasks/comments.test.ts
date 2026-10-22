import { describe, expect, it } from "vitest";
import {
  countCodePoints,
  getTaskCommentErrorMessage,
  isAddTaskCommentResult,
  isEditTaskCommentResult,
  isTaskComment,
  isTaskCommentMentionCandidate,
  isTaskCommentRetryableError,
  isTaskCommentUnavailableError,
  mergeTaskCommentPages,
  replaceTaskCommentNewestPage,
  trimTaskCommentBody,
  truncateCodePoints,
  type TaskComment,
} from "./comments";

function comment(id: string, createdAt: string, body = id): TaskComment {
  return {
    out_id: id,
    out_body: body,
    out_is_heads_up: false,
    out_created_at: createdAt,
    out_edited_at: null,
    out_author_id: `author-${id}`,
    out_author_full_name: "Member",
    out_author_avatar_url: null,
    out_mentions: [],
    out_can_edit: true,
    out_can_delete: true,
    out_has_more: false,
  };
}

describe("task comments", () => {
  it("validates the fixed reader shapes", () => {
    expect(isTaskComment(comment("one", "2026-10-23T00:00:00Z"))).toBe(true);
    expect(
      isTaskComment({
        ...comment("one", "2026-10-23T00:00:00Z"),
        out_mentions: [{ id: "user", full_name: "Member" }],
      }),
    ).toBe(true);
    expect(
      isTaskComment({
        ...comment("one", "2026-10-23T00:00:00Z"),
        out_mentions: [{ id: "user", email: "private@example.com" }],
      }),
    ).toBe(false);
    expect(
      isTaskCommentMentionCandidate({
        out_id: "user",
        out_full_name: "Member",
        out_avatar_url: null,
      }),
    ).toBe(true);
    expect(
      isAddTaskCommentResult({
        out_id: "comment",
        out_created_at: "2026-10-23T00:00:00Z",
      }),
    ).toBe(true);
    expect(
      isEditTaskCommentResult({
        out_id: "comment",
        out_edited_at: "2026-10-23T00:01:00Z",
      }),
    ).toBe(true);
  });

  it("trims before submission and counts Unicode code points", () => {
    expect(trimTaskCommentBody(" \n  hello 🙂 \t")).toBe("hello 🙂");
    expect(countCodePoints("A🙂B")).toBe(3);
    expect(truncateCodePoints("A🙂BC", 3)).toBe("A🙂B");
  });

  it("merges a loaded older page by id", () => {
    const merged = mergeTaskCommentPages(
      [
        comment("new", "2026-10-23T03:00:00Z", "old body"),
        comment("older", "2026-10-23T01:00:00Z"),
      ],
      [
        comment("latest", "2026-10-23T04:00:00Z"),
        comment("new", "2026-10-23T03:00:00Z", "edited body"),
      ],
    );

    expect(merged.map((row) => row.out_id)).toEqual(["latest", "new", "older"]);
    expect(merged[1].out_body).toBe("edited body");
  });

  it("replaces a full newest page and retains only cached older rows", () => {
    const refreshed = replaceTaskCommentNewestPage(
      [
        comment("new", "2026-10-23T05:00:00Z", "old body"),
        comment("deleted", "2026-10-23T04:00:00Z"),
        comment("boundary", "2026-10-23T03:00:00Z"),
        comment("older", "2026-10-23T02:00:00Z"),
      ],
      [
        comment("latest", "2026-10-23T06:00:00Z"),
        comment("new", "2026-10-23T05:00:00Z", "edited body"),
        comment("boundary", "2026-10-23T03:00:00Z"),
      ],
      3,
    );

    expect(refreshed.map((row) => row.out_id)).toEqual([
      "latest",
      "new",
      "boundary",
      "older",
    ]);
    expect(refreshed[1].out_body).toBe("edited body");
  });

  it("uses only a partial or empty refreshed newest page", () => {
    const current = [
      comment("new", "2026-10-23T05:00:00Z"),
      comment("deleted", "2026-10-23T04:00:00Z"),
      comment("older", "2026-10-23T03:00:00Z"),
    ];
    const partial = [
      comment("new", "2026-10-23T05:00:00Z"),
      comment("older", "2026-10-23T03:00:00Z"),
    ];

    expect(replaceTaskCommentNewestPage(current, partial, 3)).toEqual(partial);
    expect(replaceTaskCommentNewestPage(current, [], 3)).toEqual([]);
  });

  it.each([
    ["CCC01", "Comments are no longer available for this task."],
    [
      "CCC02",
      "The comments request is no longer valid. Refresh and try again.",
    ],
    ["CCC03", "A comment must contain between 1 and 4,000 characters."],
    [
      "CCC04",
      "One or more mentioned people are no longer available. Update the mentions and try again.",
    ],
    ["CCC05", "Archived task comments are read only."],
    ["CCC06", "Only the comment author can edit it."],
    ["CCC07", "You no longer have permission to delete this comment."],
    ["CCC08", "This comment changed. Refresh and try again."],
    ["CCC09", "Make a change before saving the comment."],
    [
      "CCC10",
      "The comment could not be changed safely. Refresh and try again.",
    ],
    ["40001", "Comments changed while saving. Refresh and try again."],
    ["40P01", "Comments are busy right now. Refresh and try again."],
  ])("maps %s without exposing raw database text", (code, expected) => {
    expect(
      getTaskCommentErrorMessage(
        { code, message: "sensitive database detail" },
        "edit",
      ),
    ).toBe(expected);
  });

  it("classifies unavailable and retryable failures", () => {
    expect(isTaskCommentUnavailableError({ code: "CCC01" })).toBe(true);
    expect(isTaskCommentRetryableError({ code: "40001" })).toBe(true);
    expect(isTaskCommentRetryableError({ code: "40P01" })).toBe(true);
    expect(isTaskCommentRetryableError({ code: "CCC08" })).toBe(false);
  });

  it("uses action-specific safe fallbacks for unknown failures", () => {
    expect(
      getTaskCommentErrorMessage(
        { code: "XX000", message: "raw internal failure" },
        "delete",
      ),
    ).toBe("The comment could not be deleted. Please try again.");
  });
});

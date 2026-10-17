import { describe, expect, it } from "vitest";
import { getWorkLinkErrorMessage, isTaskWorkLinks } from "./work-links";

const validResponse = {
  can_add: true,
  links: [
    {
      id: "44100000-0000-4000-8000-000000000001",
      name: "Event brief",
      url: "https://drive.google.com/file/d/File_ID-123/view",
      created_at: "2026-10-17T08:00:00.000Z",
      can_remove: true,
    },
  ],
};

describe("isTaskWorkLinks", () => {
  it("accepts a server-computed work-link response", () => {
    expect(isTaskWorkLinks(validResponse)).toBe(true);
    expect(isTaskWorkLinks({ can_add: false, links: [] })).toBe(true);
  });

  it("rejects malformed permissions and link rows", () => {
    expect(isTaskWorkLinks({ ...validResponse, can_add: "yes" })).toBe(false);
    expect(
      isTaskWorkLinks({
        ...validResponse,
        links: [{ ...validResponse.links[0], can_remove: "yes" }],
      }),
    ).toBe(false);
  });
});

describe("getWorkLinkErrorMessage", () => {
  it.each([
    ["23505", "This Drive link is already saved."],
    ["CCL04", "This task already has 20 work links."],
    [
      "CCL03",
      "This task is archived, so its work links are read only.",
    ],
    ["42501", "You no longer have permission to add this work link."],
  ])("maps %s to a safe add message", (code, message) => {
    expect(getWorkLinkErrorMessage({ code }, "add")).toBe(message);
  });

  it("uses an action-specific fallback", () => {
    expect(getWorkLinkErrorMessage(new Error("private detail"), "remove")).toBe(
      "The link could not be removed. Please try again.",
    );
  });
});

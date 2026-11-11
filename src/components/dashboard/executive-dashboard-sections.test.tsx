import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  AttentionCard,
  FreeMembersCard,
  attentionCategoryLabel,
} from "./executive-dashboard-sections";

const taskId = "123e4567-e89b-12d3-a456-426614174000";

describe("Executive Dashboard attention links", () => {
  it("links approval work to the existing task route and shows category, committee, and deadline", () => {
    const markup = renderToStaticMarkup(
      <AttentionCard section={{ status: "ready", data: [{
        category: "needs_approval",
        taskId,
        label: "Leave request",
        committeeId: "committee",
        committeeName: "COEXA",
        dueDate: "2026-11-11T16:00:00+08:00",
        sourceCreatedAt: "2026-11-11T10:00:00+08:00",
      }] }} />,
    );
    expect(markup).toContain(`href="/tasks/${taskId}"`);
    expect(markup).toContain("Needs approval · COEXA ·");
    expect(markup).toContain("Leave request");
  });

  it("never links confidential or malformed targets", () => {
    const confidential = renderToStaticMarkup(
      <AttentionCard section={{ status: "ready", data: [{
        category: "overdue", taskId: null, label: "Confidential task",
        committeeId: "committee", committeeName: "COEXA", dueDate: null,
        sourceCreatedAt: "2026-11-11T10:00:00+08:00",
      }] }} />,
    );
    const malformed = renderToStaticMarkup(
      <AttentionCard section={{ status: "ready", data: [{
        category: "overdue", taskId: "bad-target", label: "Visible task",
        committeeId: "committee", committeeName: "COEXA", dueDate: null,
        sourceCreatedAt: "2026-11-11T10:00:00+08:00",
      }] }} />,
    );
    expect(confidential).not.toContain("<a");
    expect(malformed).not.toContain("<a");
  });

  it.each([
    ["overdue", "Overdue"],
    ["due_in_24_hours", "Due in 24 hours"],
    ["needs_approval", "Needs approval"],
    ["help_wanted", "Help wanted"],
    ["needs_new_owner", "Needs a new owner"],
    ["unassigned", "Unassigned"],
    ["unexpected_reader_value", "Needs attention"],
  ])("maps %s to a safe human-readable label", (readerValue, label) => {
    expect(attentionCategoryLabel(readerValue)).toBe(label);
    expect(attentionCategoryLabel(readerValue)).not.toBe(readerValue);
  });
});

describe("Executive Dashboard free-member empty state", () => {
  it("does not infer that members are busy from an empty reader result", () => {
    const markup = renderToStaticMarkup(
      <FreeMembersCard section={{ status: "ready", data: [] }} />,
    );

    expect(markup).toContain("No members available to take work.");
    expect(markup).not.toContain("Everyone is busy");
  });
});

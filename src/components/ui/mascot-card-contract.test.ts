import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Batch C shared card and mascot contracts", () => {
  it("gives every mascot animation a motion-safe gate", () => {
    const mascot = read("src/components/ui/mascot.tsx");
    for (const name of ["animate-confetti", "animate-cheer", "animate-search", "animate-drip", "animate-zzz"]) {
      expect(mascot).toContain(`motion-safe:${name}`);
      expect(mascot).not.toMatch(new RegExp(`(?<!motion-safe:)\\b${name}\\b`));
    }
  });

  it("supports exactly the five poses and delegates waving to the login mascot", () => {
    const mascot = read("src/components/ui/mascot.tsx");
    expect(mascot).toContain('"sleeping" | "celebrating" | "searching" | "oops" | "waving"');
    expect(mascot).toContain("<TigerMascot");
  });

  it("keeps the mascot outside cards: EmptyState and error pages render no Card", () => {
    for (const path of [
      "src/components/shared/empty-state.tsx",
      "src/components/shared/oops-panel.tsx",
      "src/components/events/event-launched-moment.tsx",
    ]) {
      expect(read(path), path).not.toMatch(/<Card\b/);
    }
    expect(read("src/components/events/event-board-task-card.tsx")).not.toContain("Mascot");
  });

  it("uses the shared Card with interactive and accent options and the slow card interaction", () => {
    const card = read("src/components/ui/card.tsx");
    expect(card).toContain("motion-card-interaction");
    expect(card).toContain("interactive");
    expect(card).toContain("accent");
    expect(read("src/components/events/event-board-task-card.tsx")).toContain("interactive={!overlay}");
  });

  it("keeps a small drag handle on touch screens and Move to in the menu", () => {
    const card = read("src/components/events/event-board-task-card.tsx");
    expect(card).not.toContain("pointer-coarse:hidden");
    expect(card).toContain("Move to");
    expect(card).toContain("touch-none");
  });

  it("collapses board columns with the shared height Collapse", () => {
    const board = read("src/components/events/event-board.tsx");
    expect(board).toContain("<Collapse open={!collapsed}>");
  });

  it("ships 404 and error pages that never print the raw error", () => {
    expect(read("src/app/not-found.tsx")).toContain("OopsPanel");
    const shared = read("src/components/shared/segment-error-page.tsx");
    expect(shared).toContain("OopsPanel");
    expect(shared).not.toContain("error.message");
    expect(shared).not.toMatch(/<html|<body/);
    for (const file of ["src/app/error.tsx", "src/app/(dashboard)/error.tsx"]) {
      expect(read(file)).toContain("SegmentErrorPage");
    }
  });

  it("keeps cards in one warm orange family, with no coloured top edges", () => {
    const card = read("src/components/ui/card.tsx");
    expect(card).not.toContain("border-t-");
    expect(card).not.toContain("sky-500");
    expect(read("src/components/events/home-event-list.tsx")).not.toContain('accent="primary"');
  });

  it("hides board filters on completed phases and keeps cards while switching committee", () => {
    const board = read("src/components/events/event-board.tsx");
    expect(board).toMatch(/\{!selectedPhaseComplete \|\| !isUnfilteredSelectedPhase \? \(\s*<div\s+className=\{cn\(\s*"col-span-2 grid/);
    expect(board).toContain("placeholderData: keepPreviousData");
  });

  it("never crashes the board on an unreadable due date", () => {
    const card = read("src/components/events/event-board-task-card.tsx");
    expect(card).toContain("formatDateSafe");
    expect(card).not.toContain("dueDateFormatter.format(new Date(task.due_date))");
  });
});

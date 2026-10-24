import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EventBoardProgressRing,
  getProgressRingDashOffset,
} from "./event-board-progress-ring";

describe("EventBoardProgressRing", () => {
  it("draws no progress arc or endpoint dot at zero percent", () => {
    const markup = renderToStaticMarkup(
      <EventBoardProgressRing percentage={0} />,
    );

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("stroke-muted");
    expect(markup).not.toContain("stroke-primary");
    expect(markup.match(/<circle/g)).toHaveLength(1);
    expect(getProgressRingDashOffset(0)).toBeCloseTo(2 * Math.PI * 27);
  });

  it("draws the semantic progress arc at fifty percent", () => {
    const markup = renderToStaticMarkup(
      <EventBoardProgressRing percentage={50} />,
    );

    expect(markup).toContain("stroke-primary");
    expect(markup.match(/<circle/g)).toHaveLength(2);
    expect(getProgressRingDashOffset(50)).toBeCloseTo(Math.PI * 27);
  });

  it("draws the full semantic progress arc at one hundred percent", () => {
    const markup = renderToStaticMarkup(
      <EventBoardProgressRing percentage={100} />,
    );

    expect(markup).toContain("stroke-primary");
    expect(markup.match(/<circle/g)).toHaveLength(2);
    expect(getProgressRingDashOffset(100)).toBe(0);
  });
});

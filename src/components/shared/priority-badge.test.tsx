import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  getPriorityAccentClass,
  getPriorityDotClass,
  PriorityBadge,
  type PriorityLevel,
} from "./priority-badge";

const priorities: PriorityLevel[] = ["Low", "Medium", "High", "Critical"];

describe("PriorityBadge", () => {
  it.each(priorities)(
    "renders the %s label with semantic styling",
    (priority) => {
      const markup = renderToStaticMarkup(
        <PriorityBadge priority={priority} />,
      );

      expect(markup).toContain(`data-priority="${priority}"`);
      expect(markup).toContain(`>${priority}</span>`);
      expect(markup).toContain(`text-priority-${priority.toLowerCase()}`);
      expect(markup).toContain(`bg-priority-${priority.toLowerCase()}-soft`);
      expect(markup).toContain(
        `border-priority-${priority.toLowerCase()}-border`,
      );
      expect(getPriorityDotClass(priority)).toBe(
        `bg-priority-${priority.toLowerCase()}`,
      );
      expect(getPriorityAccentClass(priority)).toBe(
        `border-l-priority-${priority.toLowerCase()}-border`,
      );
    },
  );
});

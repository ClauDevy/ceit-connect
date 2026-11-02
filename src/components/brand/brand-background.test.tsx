import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BrandBackground } from "./brand-background";

describe("BrandBackground", () => {
  const html = renderToStaticMarkup(<BrandBackground />);

  it("is a decorative layer that stays out of the accessibility tree", () => {
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('class="brand-bg"');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("tabindex");
  });

  it("renders 11 shields, 5 of which are hidden on phones", () => {
    expect(html.match(/class="brand-bg-shield/g)).toHaveLength(11);
    expect(html.match(/max-md:hidden/g)).toHaveLength(5);
  });

  it("gives every shield desktop placement variables and the first six phone ones", () => {
    expect(html.match(/--x:/g)).toHaveLength(11);
    expect(html.match(/--s:/g)).toHaveLength(11);
    expect(html.match(/--px:/g)).toHaveLength(6);
    expect(html.match(/--ps:/g)).toHaveLength(6);
  });

  it("keeps rotations within the approved range", () => {
    const rotations = [...html.matchAll(/--r:(-?\d+)deg/g)].map((match) => Number(match[1]));

    expect(rotations).toHaveLength(11);
    for (const rotation of rotations) {
      expect(rotation).toBeGreaterThanOrEqual(-18);
      expect(rotation).toBeLessThanOrEqual(16);
    }
  });
});

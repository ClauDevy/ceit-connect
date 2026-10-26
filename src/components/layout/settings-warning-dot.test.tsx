import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsWarningDot } from "./settings-warning-dot";

describe("SettingsWarningDot", () => {
  it("has an accessible non-secret password warning", () => {
    const html = renderToStaticMarkup(<SettingsWarningDot />);
    expect(html).toContain('aria-label="Password not set"');
    expect(html).toContain('title="Password not set"');
  });
});

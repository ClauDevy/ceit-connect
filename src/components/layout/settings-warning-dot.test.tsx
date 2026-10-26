import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsWarningDot } from "./settings-warning-dot";

describe("SettingsWarningDot", () => {
  it.each([
    ["expanded desktop sidebar", false],
    ["collapsed desktop sidebar", true],
    ["mobile bottom navigation", false],
    ["mobile avatar menu", false],
  ])("adds the reminder to the Settings link name on the %s", (_, collapsed) => {
    const html = renderToStaticMarkup(
      <a href="/settings">
        <span className={collapsed ? "sr-only" : undefined}>Settings</span>
        <SettingsWarningDot />
      </a>,
    );

    expect(html).toContain('<span class="sr-only"> Password not set</span>');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
    expect(html).not.toContain("title=");
    expect(
      html
        .replace(/<span aria-hidden="true"[^>]*><\/span>/, "")
        .replace(/<[^>]+>/g, ""),
    ).toBe("Settings Password not set");
  });
});

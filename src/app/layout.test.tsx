import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/google", () => ({
  Fredoka: () => ({ variable: "display-font" }),
  Plus_Jakarta_Sans: () => ({ variable: "body-font" }),
}));
vi.mock("next/script", () => ({
  default: ({
    id,
    strategy,
    children,
  }: {
    id: string;
    strategy: string;
    children: React.ReactNode;
  }) => (
    <script id={id} data-strategy={strategy}>
      {children}
    </script>
  ),
}));
vi.mock("@/lib/utils", () => ({
  cn: (...values: string[]) => values.join(" "),
}));
vi.mock("@/lib/theme", () => ({
  THEME_INIT_SCRIPT: "document.documentElement.classList.add('theme-test')",
}));

import RootLayout from "./layout";

describe("RootLayout theme bootstrap", () => {
  it("renders an identified beforeInteractive script before page content", () => {
    const html = renderToStaticMarkup(
      <RootLayout params={Promise.resolve({})}>
        <main>Page content</main>
      </RootLayout>,
    );

    expect(html).toContain('id="ceit-theme-init"');
    expect(html).toContain('data-strategy="beforeInteractive"');
    expect(html).toContain("document.documentElement.classList.add('theme-test')");
    expect(html.indexOf("ceit-theme-init")).toBeLessThan(
      html.indexOf("Page content"),
    );
  });
});

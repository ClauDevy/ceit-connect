import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Source-contract coverage for Batch 4 (feature/branding): no jsdom here, so these
// tests pin the CSS, assets and component wiring that the manual checklist relies on.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const readBinary = (path: string) => readFileSync(resolve(process.cwd(), path));

const BRAND_SVGS = [
  "public/brand/app-logo.svg",
  "public/brand/shield-color.svg",
  "public/brand/shield-white.svg",
  "public/brand/shield-mark.svg",
  "public/brand/team-logo.svg",
  "public/brand/team-logo-dark.svg",
  "src/app/icon.svg",
];

describe("brand SVG safety", () => {
  it.each(BRAND_SVGS)("%s has no scripts, handlers, external references or raster data", (path) => {
    const svg = read(path);

    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son[a-z]+\s*=/i);
    expect(svg).not.toMatch(/<image/i);
    expect(svg).not.toMatch(/<foreignObject/i);
    expect(svg).not.toMatch(/<metadata/i);
    expect(svg).not.toMatch(/<use\b/i);
    expect(svg).not.toMatch(/href\s*=/i);
    expect(svg).not.toMatch(/data:/i);
    // The only URL allowed is the SVG namespace itself.
    expect(svg.replace("http://www.w3.org/2000/svg", "")).not.toMatch(/https?:\/\//i);
  });

  it("keeps the shield assets in the council colours", () => {
    expect(read("public/brand/shield-color.svg")).toContain('fill="#FFC000"');
    expect(read("public/brand/shield-white.svg")).toContain('fill="#FFFFFF"');
    expect(read("public/brand/shield-mark.svg")).toContain('fill="#C9631C"');
    expect(read("src/app/icon.svg")).toContain('fill="#FFC000"');
  });

  it("keeps the app logo shape that AppLogo sizes against", () => {
    expect(read("public/brand/app-logo.svg")).toContain('viewBox="0 0 743 842"');
    expect(read("src/components/ui/app-logo.tsx")).toContain("743 / 842");
  });
});

describe("favicon", () => {
  it("is a valid ICO with 16, 32 and 48 pixel PNG images", () => {
    const ico = readBinary("src/app/favicon.ico");

    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(3);

    const sizes: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      const entry = 6 + index * 16;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      sizes.push(ico[entry]);
      expect(ico.subarray(offset, offset + 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(offset + length).toBeLessThanOrEqual(ico.length);
    }
    expect(sizes).toEqual([16, 32, 48]);
  });
});

describe("shield background styles", () => {
  const css = read("src/app/globals.css");

  it("removes the paw-print pattern completely", () => {
    expect(css).not.toContain("data:image/svg+xml");
    expect(css).not.toMatch(/paw/i);
  });

  it("draws one fixed, non-interactive, clipped layer behind the app", () => {
    const layer = css.match(/\.brand-bg\s*\{[^}]*\}/)?.[0] ?? "";

    expect(layer).toMatch(/position:\s*fixed/);
    expect(layer).toMatch(/inset:\s*0/);
    expect(layer).toMatch(/z-index:\s*-1/);
    expect(layer).toMatch(/overflow:\s*hidden/);
    expect(layer).toMatch(/pointer-events:\s*none/);
    expect(layer).toContain("var(--primary)");
  });

  it("loads only the active theme's shield and team logo", () => {
    expect(css).toMatch(/\.brand-bg-shield\s*\{[^}]*shield-color\.svg/);
    expect(css).toMatch(/\.dark \.brand-bg-shield\s*\{[^}]*shield-white\.svg/);
    expect(css).toMatch(/\.brand-shield-art\s*\{[^}]*shield-color\.svg/);
    expect(css).toMatch(/\.dark \.brand-shield-art\s*\{[^}]*shield-white\.svg/);
    expect(css).toMatch(/\.brand-team-logo\s*\{[^}]*team-logo\.svg/);
    expect(css).toMatch(/\.dark \.brand-team-logo\s*\{[^}]*team-logo-dark\.svg/);
  });

  it("keeps opacities as theme tokens and hides the layer in forced-colors and print", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--brand-shield-bg-opacity:\s*0\.16/);
    expect(css).toMatch(/\.dark\s*\{[^}]*--brand-shield-bg-opacity:\s*0\.055/);
    expect(css).toMatch(/@media \(forced-colors: active\), print\s*\{\s*\.brand-bg\s*\{\s*display:\s*none/);
  });
});

describe("branding wiring", () => {
  it("shows the app logo (not the tiger head) in the desktop sidebar and phone header", () => {
    const brand = read("src/components/layout/brand.tsx");
    const topbar = read("src/components/layout/mobile-topbar.tsx");

    expect(brand).toContain("<AppLogo height={34} />");
    expect(topbar).toContain("<AppLogo height={28} />");
    expect(brand).not.toContain("TigerLogo");
    expect(topbar).not.toContain("TigerLogo");
    expect(brand).toContain("CEIT Connect");
    expect(topbar).toContain("CEIT Connect");
  });

  it("renders the backdrop once from the root layout, before page content", () => {
    const layout = read("src/app/layout.tsx");

    expect(layout).toContain("<BrandBackground />");
    expect(layout.indexOf("<BrandBackground />")).toBeLessThan(layout.indexOf("{children}"));
  });

  it("puts the shield treatment and footer on the login layout only", () => {
    const shell = read("src/components/auth/auth-shell.tsx");
    const hero = read("src/components/auth/login-hero.tsx");

    expect(shell).toContain("<LoginFooter />");
    const mascotUsages = `${shell}\n${hero}`.match(/<TigerMascot\b[^>]*\/>/g) ?? [];
    expect(mascotUsages).toHaveLength(3);
    expect(mascotUsages.every((usage) => /\bmark\b/.test(usage))).toBe(true);
    expect(shell).toContain("<TigerMascot size={104} mark />");
    expect(shell).toContain("<TigerMascot size={60} mark />");
    expect(shell).toContain("brand-shield-art");
    expect(hero).toContain('<TigerMascot size={200} mark className="relative" />');
    expect(hero).toContain("brand-shield-art");
    expect(shell).toContain('aria-label="CEIT Connect tiger mascot"');
    expect(hero).toContain('aria-label="CEIT Connect tiger mascot"');
  });

  it("keeps the tummy mark opt-in and inside the mascot drawing", () => {
    const mascot = read("src/components/ui/tiger-mascot.tsx");

    expect(mascot).toContain("mark = false");
    expect(mascot).toContain('href="/brand/shield-mark.svg"');
  });

  it("shows the required credit text with an accessible team logo", () => {
    const footer = read("src/components/auth/login-footer.tsx");

    expect(footer).toContain("Built by eduCache.on");
    expect(footer).toContain("© 2026 CEIT Student Council, Cavite State University. All rights reserved.");
    expect(footer).toContain('role="img"');
    expect(footer).toContain('aria-label="eduCache.on logo"');
    expect(footer).not.toContain("<a ");
    expect(footer).not.toMatch(/className="[^"]*\bfixed\b/);
  });

  it("uses no raw colours in the new feature markup", () => {
    for (const path of [
      "src/components/brand/brand-background.tsx",
      "src/components/auth/login-footer.tsx",
      "src/components/ui/app-logo.tsx",
      "src/components/auth/auth-shell.tsx",
      "src/components/auth/login-hero.tsx",
    ]) {
      expect(read(path), path).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
  });
});

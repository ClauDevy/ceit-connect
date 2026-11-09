import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import manifest from "@/app/manifest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const readBinary = (path: string) => readFileSync(resolve(process.cwd(), path));

type DecodedPng = {
  height: number;
  pixels: Buffer;
  width: number;
};

function paeth(left: number, above: number, upperLeft: number) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  return aboveDistance <= upperLeftDistance ? above : upperLeft;
}

function decodeRgbPng(path: string): DecodedPng {
  const png = readBinary(path);
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  expect(png[24]).toBe(8);
  expect(png[25]).toBe(2);
  expect(png[28]).toBe(0);

  const idat: Buffer[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    if (type === "IDAT") idat.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === "IEND") break;
  }

  const bytesPerPixel = 3;
  const stride = width * bytesPerPixel;
  const filtered = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * (stride + 1);
    const filter = filtered[sourceRow];
    for (let x = 0; x < stride; x += 1) {
      const value = filtered[sourceRow + 1 + x];
      const target = y * stride + x;
      const left = x >= bytesPerPixel ? pixels[target - bytesPerPixel] : 0;
      const above = y > 0 ? pixels[target - stride] : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel
        ? pixels[target - stride - bytesPerPixel]
        : 0;

      if (filter === 0) pixels[target] = value;
      else if (filter === 1) pixels[target] = (value + left) & 0xff;
      else if (filter === 2) pixels[target] = (value + above) & 0xff;
      else if (filter === 3) pixels[target] = (value + Math.floor((left + above) / 2)) & 0xff;
      else if (filter === 4) pixels[target] = (value + paeth(left, above, upperLeft)) & 0xff;
      else throw new Error(`Unsupported PNG filter ${filter}`);
    }
  }

  return { height, pixels, width };
}

function rgbAt(image: DecodedPng, x: number, y: number) {
  const offset = (y * image.width + x) * 3;
  return Array.from(image.pixels.subarray(offset, offset + 3));
}

describe("I1 web manifest", () => {
  it("pins the approved standalone identity and paper launch colors", () => {
    expect(manifest()).toMatchObject({
      id: "/",
      name: "CEIT Connect",
      short_name: "CEIT Connect",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#FFF8F0",
      theme_color: "#FFF8F0",
    });
    expect(manifest()).not.toHaveProperty("orientation");
  });

  it("publishes ordinary and maskable static icons without offline fields", () => {
    expect(manifest().icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/maskable-icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]);
    expect(JSON.stringify(manifest())).not.toMatch(/service.?worker|push|orientation/i);
  });
});

describe("I1 static icon contract", () => {
  const icons = [
    ["public/icons/icon-192.png", 192],
    ["public/icons/icon-512.png", 512],
    ["public/icons/maskable-icon-512.png", 512],
    ["public/icons/apple-touch-icon.png", 180],
  ] as const;

  it.each(icons)("keeps %s as opaque RGB with exact dimensions and a safe shield", (path, size) => {
    const image = decodeRgbPng(path);
    expect([image.width, image.height]).toEqual([size, size]);

    const background = [0x1b, 0x14, 0x0f];
    expect(rgbAt(image, 0, 0)).toEqual(background);
    expect(rgbAt(image, size - 1, 0)).toEqual(background);
    expect(rgbAt(image, 0, size - 1)).toEqual(background);
    expect(rgbAt(image, size - 1, size - 1)).toEqual(background);

    let minX: number = size;
    let minY: number = size;
    let maxX: number = -1;
    let maxY: number = -1;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const [red, green, blue] = rgbAt(image, x, y);
        const isGoldShield = red > 100 && green > 60 && blue < 80;
        if (isGoldShield) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    const shieldWidth = (maxX - minX + 1) / size;
    const shieldHeight = (maxY - minY + 1) / size;
    expect(shieldWidth).toBeGreaterThanOrEqual(0.59);
    expect(shieldWidth).toBeLessThanOrEqual(0.7);
    expect(shieldHeight).toBeGreaterThanOrEqual(0.59);
    expect(shieldHeight).toBeLessThanOrEqual(0.7);
    expect((minX + maxX + 1) / 2 / size).toBeCloseTo(0.5, 1);
    expect((minY + maxY + 1) / 2 / size).toBeCloseTo(0.5, 1);
  });

  it("keeps the approved SVG source byte-for-byte unchanged", () => {
    const digest = createHash("sha256")
      .update(readBinary("src/app/icon.svg"))
      .digest("hex");
    expect(digest).toBe("638436950359decc75dc6382f0ecd2f62058979686fbbf1af5b3a2483961a198");
  });
});

describe("I1 metadata and public-route contract", () => {
  const layout = read("src/app/layout.tsx");
  const proxy = read("src/proxy.ts");

  it("adds Apple metadata and per-scheme browser colors", () => {
    expect(layout).toContain('url: "/icons/apple-touch-icon.png"');
    expect(layout).toContain('sizes: "180x180"');
    expect(layout).toContain("appleWebApp:");
    expect(layout).toContain('statusBarStyle: "default"');
    expect(layout).toContain('{ media: "(prefers-color-scheme: light)", color: "#FFF8F0" }');
    expect(layout).toContain('{ media: "(prefers-color-scheme: dark)", color: "#1B140F" }');
  });

  it("keeps manifest and icons outside session refresh without weakening app routes", () => {
    expect(proxy).toContain("manifest\\\\.webmanifest");
    expect(proxy).toContain(".*\\\\.(?:svg|png|jpg|jpeg|webp)$");
    expect(proxy).toContain('"Cache-Control"');
    expect(proxy).toContain('"no-store, no-cache, must-revalidate, proxy-revalidate"');
    expect(proxy).not.toMatch(/login|redirect/);
    expect(proxy).not.toMatch(/auth\/callback|auth\/signout|home/);
  });
});

describe("I1 Settings help source contract", () => {
  const help = read("src/components/settings/install-app-help.tsx");
  const settings = read("src/app/(dashboard)/settings/page.tsx");

  it("renders a neutral first state and tracks standalone display changes", () => {
    expect(help).toContain("useState<boolean | null>(null)");
    expect(help).toContain('window.matchMedia("(display-mode: standalone)")');
    expect(help).toContain('displayMode.addEventListener("change", update)');
    expect(help).toContain('displayMode.removeEventListener("change", update)');
    expect(help).toContain("Checking how you opened CEIT Connect…");
    expect(help).toContain("You&apos;re using the installed app.");
  });

  it("keeps iPhone first, includes the Android fallback, and has no custom prompt", () => {
    expect(help.indexOf("iPhone")).toBeLessThan(help.indexOf("Android"));
    expect(help).toContain("Open CEIT Connect in Safari.");
    expect(help).toContain("Tap Share.");
    expect(help).toContain("Tap Add to Home Screen.");
    expect(help).toContain("Tap Install app, or Add to Home screen if you see that instead.");
    expect(help).toContain("the installed app keeps its own sign-in");
    expect(help).toContain("invite and reset");
    expect(help).not.toMatch(/beforeinstallprompt|appinstalled|<button/i);
    expect(settings).toContain('title="Install the app"');
    expect(settings).toContain("<InstallAppHelp />");
  });
});

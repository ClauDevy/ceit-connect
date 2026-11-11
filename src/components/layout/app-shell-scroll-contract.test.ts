import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const shell = readFileSync(
  resolve(process.cwd(), "src/components/layout/app-shell.tsx"),
  "utf8",
);

describe("AppShell scroll containment", () => {
  it("keeps the viewport shell out of document flow", () => {
    expect(shell).toContain(
      'className="fixed inset-x-0 top-0 flex h-dvh min-h-0 w-full overflow-hidden"',
    );
    expect(shell).not.toContain("overflow-clip");
  });

  it("makes the content column the sole bounded vertical scroller", () => {
    expect(shell).toContain(
      "min-h-0 min-w-0 flex-1 scroll-pt-24 flex-col overflow-x-hidden overflow-y-auto overscroll-contain",
    );
  });
});

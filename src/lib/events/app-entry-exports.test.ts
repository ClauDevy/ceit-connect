import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const entryFiles = [
  {
    path: "src/app/api/event-deletion/route.ts",
    allowed: ["POST", "maxDuration"],
    requiresLiteralMaxDuration: true,
  },
  {
    path: "src/app/api/event-storage-cleanup/route.ts",
    allowed: ["POST", "maxDuration"],
    requiresLiteralMaxDuration: true,
  },
  {
    path: "src/app/(dashboard)/event-management/page.tsx",
    allowed: ["default"],
    requiresLiteralMaxDuration: false,
  },
  {
    path: "src/app/(dashboard)/event-management/loading.tsx",
    allowed: ["default"],
    requiresLiteralMaxDuration: false,
  },
] as const;

function maskCommentsAndStrings(source: string) {
  return source.replace(
    /("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/)/g,
    (match) => match.replace(/[^\r\n]/g, " "),
  );
}

function exportedNames(source: string) {
  const code = maskCommentsAndStrings(source);
  const names = new Set<string>();
  if (/\bexport\s+default\b/.test(code)) names.add("default");

  for (const match of code.matchAll(
    /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.add(match[1]);
  }

  for (const match of code.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const item of match[1].split(",")) {
      const name = item.trim().split(/\s+as\s+/).at(-1);
      if (name) names.add(name);
    }
  }

  return [...names].sort();
}

function entryExportViolations(
  source: string,
  path: string,
  allowed: readonly string[],
) {
  const violations: string[] = [];
  const code = maskCommentsAndStrings(source);

  if (/\bexport\s*\*\s*(?:as\s+[A-Za-z_$][\w$]*\s*)?from\b/.test(code)) {
    violations.push(`wildcard re-export is not allowed in ${path}`);
  }

  violations.push(
    ...exportedNames(source)
      .filter((name) => !allowed.includes(name))
      .map((name) => `export ${name} is not allowed in ${path}`),
  );

  return violations;
}

describe("App entry export validation helper", () => {
  it("keeps detecting supported export forms", () => {
    const source = `
      export default function Page() {}
      export const maxDuration = 30;
      export async function POST() {}
      export type LocalType = string;
      export { localValue, sourceValue as publicValue };
      export { remoteValue } from "./remote";
    `;

    expect(exportedNames(source)).toEqual([
      "LocalType",
      "POST",
      "default",
      "localValue",
      "maxDuration",
      "publicValue",
      "remoteValue",
    ]);
  });

  it.each([
    ['export * from "./other";', "wildcard re-export is not allowed in sample/route.ts"],
    ['export * as other from "./other";', "wildcard re-export is not allowed in sample/route.ts"],
  ])("reports wildcard re-export syntax as an explicit violation", (source, message) => {
    expect(entryExportViolations(source, "sample/route.ts", ["POST", "maxDuration"]))
      .toContain(message);
  });

  it("ignores export-like text in comments and string literals", () => {
    const source = `
      // export * from "./commented";
      const example = 'export * as hidden from "./string";';
      export const maxDuration = 30;
      export async function POST() {}
    `;

    expect(entryExportViolations(source, "sample/route.ts", ["POST", "maxDuration"]))
      .toEqual([]);
  });
});

describe("Event Management App entry exports", () => {
  for (const entry of entryFiles) {
    it(`${entry.path} exports only its allowed App entry names`, () => {
      const source = readFileSync(entry.path, "utf8");
      expect(entryExportViolations(source, entry.path, entry.allowed)).toEqual([]);
      expect(exportedNames(source)).toEqual([...entry.allowed].sort());
      if (entry.requiresLiteralMaxDuration) {
        expect(source).toMatch(
          /export\s+const\s+maxDuration\s*=\s*\d+\s*;/,
        );
      }
    });
  }
});

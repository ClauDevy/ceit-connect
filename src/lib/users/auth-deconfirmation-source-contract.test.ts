import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);

function productionSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) return productionSourceFiles(path);
    const extension = entry.slice(entry.lastIndexOf("."));
    if (!sourceExtensions.has(extension)) return [];
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry)) return [];
    return [path];
  });
}

function propertyName(property: ts.ObjectLiteralElementLike) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return null;
}

function findInitializer(sourceFile: ts.SourceFile, name: string) {
  let found: ts.Expression | undefined;
  function walk(node: ts.Node) {
    if (
      !found &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      found = node.initializer;
    }
    ts.forEachChild(node, walk);
  }
  walk(sourceFile);
  return found;
}

export function findForbiddenAuthAssignments(path: string, source: string) {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: string[] = [];

  function inspectObject(node: ts.ObjectLiteralExpression, context: string) {
    for (const property of node.properties) {
      const isShorthand = ts.isShorthandPropertyAssignment(property);
      if (!isShorthand && !ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property);
      if (name !== "email_confirm" && name !== "email_confirmed_at") continue;
      // `{ email_confirm }` hides its value in a variable: resolve it, or reject it.
      const value = ts.isShorthandPropertyAssignment(property)
        ? findInitializer(sourceFile, property.name.text)
        : (property as ts.PropertyAssignment).initializer;
      if (isShorthand && !value) {
        findings.push(`${path}: ${context} writes ${name} from an unresolvable shorthand value`);
        continue;
      }
      if (name === "email_confirm" && value?.kind === ts.SyntaxKind.FalseKeyword) {
        findings.push(`${path}: ${context} sets email_confirm false`);
      }
      if (name === "email_confirmed_at" && value?.kind === ts.SyntaxKind.NullKeyword) {
        findings.push(`${path}: ${context} clears email_confirmed_at`);
      }
    }
  }

  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      const method = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : null;
      const isAuthAdminMutation =
        /\.auth\.admin\./.test(callee) &&
        method !== null &&
        /^(?:updateUserById|updateUser|createUser|inviteUserByEmail)$/.test(method);
      const isAuthUserUpdate = /\.auth\.updateUser$/.test(callee);
      if (isAuthAdminMutation || isAuthUserUpdate) {
        for (const argument of node.arguments) {
          if (ts.isObjectLiteralExpression(argument)) {
            inspectObject(argument, callee);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return findings;
}

describe("Auth confirmation source boundary", () => {
  it("keeps every non-test src writer from deconfirming an Auth user", () => {
    const files = productionSourceFiles("src");
    const findings = files.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const textual: string[] = [];
      if (/email_confirm\s*:\s*false/.test(source)) {
        textual.push(`${path}: contains email_confirm false`);
      }
      if (/email_confirmed_at\s*[:=]\s*null/.test(source)) {
        textual.push(`${path}: clears email_confirmed_at`);
      }
      return [...textual, ...findForbiddenAuthAssignments(path, source)];
    });

    expect(findings).toEqual([]);
  });
});

describe("Auth confirmation scanner fixtures", () => {
  const scan = (body: string) => findForbiddenAuthAssignments("fixture.ts", body);
  const call = (props: string) => `supabase.auth.admin.updateUserById("id", { ${props} });`;

  it("keeps explicit email_confirm true valid", () => {
    expect(scan(call("email_confirm: true"))).toEqual([]);
  });

  it("flags shorthand email_confirm resolved to false", () => {
    expect(scan(`const email_confirm = false;\n${call("email_confirm")}`)).toHaveLength(1);
  });

  it("flags shorthand email_confirmed_at resolved to null", () => {
    expect(scan(`const email_confirmed_at = null;\n${call("email_confirmed_at")}`)).toHaveLength(1);
  });

  it("rejects shorthand values it cannot resolve", () => {
    expect(scan(`function run(email_confirm: boolean) {\n${call("email_confirm")}\n}`)).toHaveLength(1);
  });

  it("allows shorthand resolved to true", () => {
    expect(scan(`const email_confirm = true;\n${call("email_confirm")}`)).toEqual([]);
  });
});

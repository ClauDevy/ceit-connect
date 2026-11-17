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

function findForbiddenAuthAssignments(path: string, source: string) {
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
      if (!ts.isPropertyAssignment(property)) continue;
      const name = propertyName(property);
      if (
        name === "email_confirm" &&
        property.initializer.kind === ts.SyntaxKind.FalseKeyword
      ) {
        findings.push(`${path}: ${context} sets email_confirm false`);
      }
      if (
        name === "email_confirmed_at" &&
        property.initializer.kind === ts.SyntaxKind.NullKeyword
      ) {
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

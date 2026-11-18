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

function declarationIn(
  list: { declarations: readonly ts.VariableDeclaration[] },
  name: string,
) {
  return list.declarations.find(
    (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name,
  );
}

/**
 * Resolves `name` to the initializer of the binding visible at `from`: the nearest enclosing
 * scope wins, so a shadowing `const` inside a function beats one at module level. A function
 * parameter, or any binding without an initializer, is unresolvable (undefined).
 */
function resolveBinding(from: ts.Node, name: string): ts.Expression | undefined {
  for (let scope: ts.Node | undefined = from.parent; scope; scope = scope.parent) {
    if (ts.isFunctionLike(scope)) {
      const isParameter = scope.parameters.some(
        (parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name,
      );
      if (isParameter) return undefined;
    }
    // Loop-owned bindings (`for (let x = ...)`, `for (const x of ...)`) shadow outer ones.
    // for-in/for-of declarations have no initializer, so they resolve to undefined.
    if (
      (ts.isForStatement(scope) || ts.isForInStatement(scope) || ts.isForOfStatement(scope)) &&
      scope.initializer &&
      ts.isVariableDeclarationList(scope.initializer)
    ) {
      const own = declarationIn(scope.initializer, name);
      if (own) return own.initializer;
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration) {
      if (declarationIn({ declarations: [scope.variableDeclaration] }, name)) return undefined;
    }
    if (ts.isBlock(scope) || ts.isSourceFile(scope) || ts.isModuleBlock(scope)) {
      for (const statement of scope.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        const own = declarationIn(statement.declarationList, name);
        if (own) return own.initializer;
      }
    }
  }
  return undefined;
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
        ? resolveBinding(property, property.name.text)
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
          // A payload held in a variable (`updateUserById(id, attributes)`) is resolved first.
          const payload = ts.isIdentifier(argument)
            ? resolveBinding(argument, argument.text)
            : argument;
          if (payload && ts.isObjectLiteralExpression(payload)) {
            inspectObject(payload, callee);
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

  it("uses the binding visible at the call, not the first declaration in the file", () => {
    expect(
      scan(
        `const email_confirm = true;\nfunction run() {\n const email_confirm = false;\n ${call("email_confirm")}\n}`,
      ),
    ).toHaveLength(1);
    expect(
      scan(
        `const email_confirm = false;\nfunction run() {\n const email_confirm = true;\n ${call("email_confirm")}\n}`,
      ),
    ).toEqual([]);
  });

  it("resolves a payload passed through a variable", () => {
    const send = `supabase.auth.admin.updateUserById("id", attributes);`;
    expect(scan(`const attributes = { email_confirm: false };\n${send}`)).toHaveLength(1);
    expect(scan(`const attributes = { email_confirm: true };\n${send}`)).toEqual([]);
  });

  it("resolves a for-loop binding before outer scopes", () => {
    expect(
      scan(
        `const email_confirm = true;\nfor (let email_confirm = false; ; ) {\n ${call("email_confirm")}\n break;\n}`,
      ),
    ).toHaveLength(1);
    expect(
      scan(
        `const email_confirm = false;\nfor (let email_confirm = true; ; ) {\n ${call("email_confirm")}\n break;\n}`,
      ),
    ).toEqual([]);
  });

  it("rejects a for-of binding it cannot resolve", () => {
    expect(
      scan(`const email_confirm = true;\nfor (const email_confirm of []) {\n ${call("email_confirm")}\n}`),
    ).toHaveLength(1);
  });
});

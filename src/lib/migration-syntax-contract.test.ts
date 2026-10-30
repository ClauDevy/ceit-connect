import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationsDirectory = "supabase/migrations";
const lineCommentPattern = /--[^\r\n]*/g;
const blockCommentPattern = /\/\*[\s\S]*?\*\//g;
const qualifiedCoalescePattern = /\bpg_catalog\.coalesce\s*\(/i;
const unparenthesizedIfCasePattern = /\bif\s+case\b/i;

function withoutSqlComments(sql: string) {
  return sql
    .replace(blockCommentPattern, " ")
    .replace(lineCommentPattern, " ");
}

describe("migration PL/pgSQL syntax contract", () => {
  for (const filename of readdirSync(migrationsDirectory).filter((name) =>
    name.endsWith(".sql"),
  )) {
    it(`${filename} avoids unsupported conditional syntax`, () => {
      const migration = withoutSqlComments(
        readFileSync(`${migrationsDirectory}/${filename}`, "utf8"),
      );

      expect(migration).not.toMatch(qualifiedCoalescePattern);
      expect(migration).not.toMatch(unparenthesizedIfCasePattern);
    });
  }

  it("allows a parenthesized CASE condition and ignores comments", () => {
    const allowed = withoutSqlComments(`
      -- pg_catalog.coalesce(value, false)
      /* if case when value then true else false end then */
      if (case when value then true else false end) then
        null;
      end if;
    `);

    expect(allowed).not.toMatch(qualifiedCoalescePattern);
    expect(allowed).not.toMatch(unparenthesizedIfCasePattern);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261030130000_draft_task_visibility.sql",
  "utf8",
).toLowerCase();

describe("Batch 13c migration syntax constructs", () => {
  it("does not schema-qualify conditional SQL syntax constructs", () => {
    expect(migration).not.toMatch(
      /pg_catalog\.(?:coalesce|nullif|greatest|least)\s*\(/,
    );
  });
});

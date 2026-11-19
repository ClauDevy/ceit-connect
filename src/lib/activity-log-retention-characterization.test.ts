import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20261029140000_activity_log_retention.sql",
  ),
  "utf8",
).replace(/\r\n/g, "\n");

describe("current Activity Log purge characterization", () => {
  it("pins the rolling cutoff, bounded oldest-first deletion, and postgres boundary", () => {
    expect(migration).toContain("if session_user <> 'postgres' then");
    expect(migration).toContain(
      "log_row.created_at\n      < pg_catalog.now() - pg_catalog.make_interval(\n          days => public.activity_log_retention_days()",
    );
    expect(migration).toContain("order by log_row.created_at, log_row.id");
    expect(migration).toContain("limit 5000");
    expect(migration).toContain("for update of log_row skip locked");
  });

  it("pins the transaction-local marker and its success and exception cleanup", () => {
    expect(migration).toContain("'ceit_connect.activity_log_purger'");
    expect(migration).toContain("'purge_activity_log',\n    true");
    expect(migration.match(/'ceit_connect\.activity_log_purger',\n\s+'',\n\s+true/g))
      .toHaveLength(2);
  });

  it("pins raw DELETE denial and unconditional TRUNCATE denial", () => {
    expect(migration).toContain("if tg_op = 'TRUNCATE' then");
    expect(migration).toContain(
      "if current_user <> 'postgres'\n     or v_purger is distinct from 'purge_activity_log' then",
    );
    expect(migration).toContain(
      "before delete or truncate on public.activity_log",
    );
  });
});

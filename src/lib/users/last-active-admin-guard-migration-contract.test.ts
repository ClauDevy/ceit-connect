import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrationName = "20261122120000_last_active_admin_guard.sql";
const latestMigrationName = "20261123120000_task_editor_self_assignment.sql";
const migrationPath = `supabase/migrations/${migrationName}`;
const rawMigration = readFileSync(migrationPath, "utf8");
const migration = rawMigration.replaceAll("\r\n", "\n");
const officerMigration = readFileSync(
  "supabase/migrations/20261027150000_former_member_anonymization.sql",
  "utf8",
).replaceAll("\r\n", "\n");
const officerBaseMigration = readFileSync(
  "supabase/migrations/20261026120000_officer_invitations_and_transitions.sql",
  "utf8",
).replaceAll("\r\n", "\n");

describe("last active Admin guard migration contract", () => {
  it("is tracked immediately before Batch C and stays later than V1b", () => {
    const migrations = readdirSync("supabase/migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrations.indexOf(latestMigrationName)).toBe(
      migrations.indexOf(migrationName) + 1,
    );
    expect(migrationName > "20261121140000_president_committee_admin_guard.sql").toBe(
      true,
    );
  });

  it("uses LF, dollar quoting, empty paths, and no privileged bypass", () => {
    expect(rawMigration).not.toContain("\r");
    expect(migration).not.toMatch(/\bE'/);
    expect(migration).not.toContain("session_user");
    expect(migration).not.toContain("current_user");
    expect(migration).not.toContain("service_role =");
    expect(migration).not.toContain("ceit_connect.officer_writer");
    expect(migration.match(/set search_path = ''/g)).toHaveLength(2);
  });

  it("requires read committed isolation before the officer lock in a BEFORE statement trigger", () => {
    expect(migration).toContain(`create trigger users_lock_last_active_admin_updates
before update of role, is_active, anonymized_at, committee_id
on public.users
for each statement execute function public.lock_last_active_admin_updates();`);
    expect(migration).toContain(
      "public.officer_advisory_lock_key()",
    );
    expect(migration).toContain(
      "if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then",
    );
    expect(migration).toContain("errcode = 'CCG03'");
    expect(migration).toContain(
      "message = 'Admin changes require read committed isolation.'",
    );
    expect(
      migration.indexOf("errcode = 'CCG03'"),
    ).toBeLessThan(migration.indexOf("pg_catalog.pg_advisory_xact_lock"));
    expect(migration).not.toContain("for each row execute function public.lock_last_active_admin_updates");
  });

  it("checks the resulting count in the final AFTER row layer", () => {
    expect(migration).toContain(`create trigger users_guard_last_active_admin
after update of role, is_active, anonymized_at, committee_id
on public.users
for each row`);
    expect(migration).toContain("old.role = 'Admin'");
    expect(migration).toContain("old.is_active");
    expect(migration).toContain("old.anonymized_at is null");
    expect(migration).toContain("new.role is distinct from old.role");
    expect(migration).toContain("new.is_active is distinct from old.is_active");
    expect(migration).toContain(
      "new.anonymized_at is distinct from old.anonymized_at",
    );
    expect(migration).toContain("auth_user.email_confirmed_at is not null");
    expect(migration).toContain("errcode = 'CCG02'");
    expect(migration).toContain(
      "message = 'At least one active Admin is required.'",
    );
  });

  it("pins trigger-layer order without replacing existing writers", () => {
    expect(officerBaseMigration).toContain(`create trigger users_guard_officer_writes
before insert or update or delete on public.users`);
    expect(
      readFileSync(
        "supabase/migrations/20261121140000_president_committee_admin_guard.sql",
        "utf8",
      ).replaceAll("\r\n", "\n"),
    ).toContain(`create trigger users_guard_president_committee
before insert or update on public.users`);
    expect(migration).not.toContain("create or replace function");
    expect(migration.match(/create function public\./g)).toHaveLength(2);
  });

  it("pins owners, grants, and the existing hard-delete boundary", () => {
    for (const name of [
      "lock_last_active_admin_updates",
      "guard_last_active_admin",
    ]) {
      expect(migration).toContain(
        `alter function public.${name}() owner to postgres;`,
      );
      expect(migration).toContain(`revoke all on function public.${name}()
from public, anon, authenticated, service_role;`);
    }
    expect(officerMigration).toContain("if tg_op = 'DELETE' then");
    expect(officerMigration).toContain("User profiles cannot be deleted.");
  });
});

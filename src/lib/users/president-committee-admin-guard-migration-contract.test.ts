import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const originalPath =
  "supabase/migrations/20261026120000_officer_invitations_and_transitions.sql";
const migrationPath =
  "supabase/migrations/20261121140000_president_committee_admin_guard.sql";
const original = readFileSync(originalPath, "utf8").replaceAll("\r\n", "\n");
const rawMigration = readFileSync(migrationPath, "utf8");
const migration = rawMigration.replaceAll("\r\n", "\n");

const fixedMessage = "Only Admins can be assigned to the President committee.";

function functionBody(source: string, name: string) {
  const plain = source.indexOf(`create function public.${name}(`);
  const replacement = source.indexOf(`create or replace function public.${name}(`);
  const start = Math.max(plain, replacement);
  expect(start).toBeGreaterThanOrEqual(0);
  const bodyStart = source.indexOf("as $$\n", start) + "as $$\n".length;
  const bodyEnd = source.indexOf("\n$$;", bodyStart);
  expect(bodyStart).toBeGreaterThan("as $$\n".length - 1);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  return source.slice(bodyStart, bodyEnd);
}

const oldOpening = `begin
  perform pg_catalog.pg_advisory_xact_lock(
    public.officer_advisory_lock_key()
  );
  v_caller_id := public.officer_require_active_admin();
  v_caps_enabled := public.officer_caps_are_enabled();`;

const newOpening = `begin
  v_caller_id := public.officer_require_active_admin();

  perform pg_catalog.pg_advisory_xact_lock(
    public.officer_advisory_lock_key()
  );
  v_caller_id := public.officer_require_active_admin();
  v_caps_enabled := public.officer_caps_are_enabled();`;

const latestCommitteeValidation = `    if (p_role = 'Admin' and p_committee_id is not null)
       or (p_role = 'Co-Admin'
           and not public.officer_committee_exists(p_committee_id)) then
      raise exception using
        errcode = 'CCO02',
        message = 'The selected officer committee is invalid.';
    end if;`;

const presidentPreparationBlock = `

    if p_role is distinct from 'Admin'
       and exists (
         select 1
         from public.committees as committee_row
         where committee_row.id = p_committee_id
           and committee_row.name = 'President'
       ) then
      raise exception using
        errcode = 'CCG01',
        message = '${fixedMessage}';
    end if;`;

describe("V1b President committee Admin guard migration contract", () => {
  it("keeps the migration timestamp later than every other tracked migration", () => {
    const migrations = readdirSync("supabase/migrations")
      .filter((file) => file.endsWith(".sql"))
      .sort();
    expect(migrations.at(-1)).toBe(
      "20261121140000_president_committee_admin_guard.sql",
    );
  });

  it("uses LF, dollar quoting, and no session or service-role exception", () => {
    expect(rawMigration).not.toContain("\r");
    expect(migration).not.toMatch(/\bE'/);
    expect(migration).not.toContain("session_user");
    expect(migration).not.toContain("current_user = 'service_role'");
    expect(migration).not.toContain("auth.role() = 'service_role'");
  });

  it("keeps invite_new_officer equal to the latest body plus only two approved edits", () => {
    const oldBody = functionBody(original, "invite_new_officer");
    const newBody = functionBody(migration, "invite_new_officer");
    expect(oldBody.split(oldOpening)).toHaveLength(2);
    expect(oldBody.split(latestCommitteeValidation)).toHaveLength(2);
    const expected = oldBody
      .replace(oldOpening, newOpening)
      .replace(
        latestCommitteeValidation,
        latestCommitteeValidation + presidentPreparationBlock,
      );
    expect(newBody).toBe(expected);
  });

  it("authorizes before the lock and reauthorizes after waiting", () => {
    const body = functionBody(migration, "invite_new_officer");
    const firstAuthorization = body.indexOf(
      "v_caller_id := public.officer_require_active_admin();",
    );
    const lock = body.indexOf("perform pg_catalog.pg_advisory_xact_lock(");
    const secondAuthorization = body.indexOf(
      "v_caller_id := public.officer_require_active_admin();",
      firstAuthorization + 1,
    );
    expect(firstAuthorization).toBeGreaterThanOrEqual(0);
    expect(firstAuthorization).toBeLessThan(lock);
    expect(lock).toBeLessThan(secondAuthorization);
    expect(body.slice(body.indexOf("begin") + 5, firstAuthorization).trim()).toBe("");
  });

  it("pins the complete-row guard and exact grandfather exception", () => {
    const body = functionBody(migration, "guard_president_committee_admin");
    expect(body).toContain("committee_row.id = new.committee_id");
    expect(body).toContain("committee_row.name = 'President'");
    expect(body).toContain("if new.role = 'Admin' then");
    expect(body).toContain("if tg_op = 'UPDATE' then");
    expect(body).toContain("new.role is not distinct from old.role");
    expect(body).toContain(
      "new.committee_id is not distinct from old.committee_id",
    );
    expect(body).not.toContain("session_user");
  });

  it("pins the fixed denial code and text at both enforcement layers", () => {
    expect(migration.match(/errcode = 'CCG01'/g)).toHaveLength(2);
    expect(migration.match(new RegExp(fixedMessage.replaceAll(".", "\\."), "g"))).toHaveLength(2);
  });

  it("pins trigger order, events, owner, search paths, and grants", () => {
    expect("users_guard_officer_writes" < "users_guard_president_committee").toBe(true);
    expect(migration).toContain(`create trigger users_guard_president_committee
before insert or update on public.users
for each row execute function public.guard_president_committee_admin();`);
    expect(migration).toContain(`create function public.guard_president_committee_admin()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''`);
    expect(migration).toContain(
      "alter function public.guard_president_committee_admin() owner to postgres;",
    );
    expect(migration).toContain(`revoke all on function public.guard_president_committee_admin()
from public, anon, authenticated, service_role;`);
    expect(migration).not.toMatch(
      /grant execute on function public\.guard_president_committee_admin/i,
    );
    expect(migration).toContain(`alter function public.invite_new_officer(uuid,uuid,text,text,text,uuid)
owner to postgres;`);
    expect(migration).toContain(`revoke all on function public.invite_new_officer(uuid,uuid,text,text,text,uuid)
from public, anon, authenticated, service_role;`);
    expect(migration).toContain(`grant execute on function public.invite_new_officer(uuid,uuid,text,text,text,uuid)
to authenticated;`);
  });
});

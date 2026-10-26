import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261026150000_coadmin_user_management.sql",
  "utf8",
);
const reader = migration.slice(
  migration.indexOf("create function public.list_managed_users"),
  migration.indexOf("create function public.finalize_member_invite"),
);

describe("Admin list_managed_users parity", () => {
  it("returns every field consumed by the existing Admin table and cards", () => {
    for (const field of [
      "id uuid",
      "full_name text",
      "email text",
      "role text",
      "committee_id uuid",
      "avatar_url text",
      "is_active boolean",
    ]) {
      expect(reader).toContain(field);
    }
  });

  it("keeps all Admin roles and committees in stable name/id order", () => {
    expect(reader).toContain("v_caller.role = 'Admin'");
    expect(reader).toContain("order by profile.full_name, profile.id");
    expect(reader).toContain("limit 21");
    expect(reader).not.toMatch(/profile\.role\s*=\s*'Member'[\s\S]*v_caller\.role = 'Admin'/);
  });

  it.each([
    "pg_catalog.lower(profile.full_name)",
    "pg_catalog.lower(profile.email)",
    "pg_catalog.lower(profile.role)",
    "pg_catalog.lower(coalesce(committee.name, ''))",
  ])("keeps case-insensitive literal search through %s", (expression) => {
    expect(reader).toContain(`pg_catalog.strpos(\n        ${expression}`);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20261109123000_revoke_inactive_user_sessions.sql",
  "utf8",
);

describe("Batch 14 reversible-deactivation session cleanup", () => {
  it("requires service_role, an inactive profile, and a prior Auth ban", () => {
    expect(migration).toContain("auth.role() is distinct from 'service_role'");
    expect(migration).toContain("v_is_active is distinct from false");
    expect(migration).toMatch(
      /v_banned_until is null[\s\S]*v_banned_until <= pg_catalog\.clock_timestamp\(\)/,
    );
  });

  it("removes and verifies both refreshable-session stores", () => {
    expect(migration).toContain("delete from auth.sessions");
    expect(migration).toContain("delete from auth.refresh_tokens");
    expect(migration).toMatch(
      /if exists \([\s\S]*from auth\.sessions[\s\S]*or exists \([\s\S]*from auth\.refresh_tokens/,
    );
  });

  it("does not mutate identities or ordinary Auth metadata", () => {
    expect(migration).not.toContain("delete from auth.identities");
    expect(migration).not.toContain("update auth.users");
    expect(migration).not.toContain("raw_user_meta_data");
  });

  it("is postgres-owned and executable only by service_role", () => {
    expect(migration).toContain(
      "alter function public.revoke_inactive_user_sessions(uuid) owner to postgres",
    );
    expect(migration).toContain(
      "revoke all on function public.revoke_inactive_user_sessions(uuid) from authenticated",
    );
    expect(migration).toContain(
      "grant execute on function public.revoke_inactive_user_sessions(uuid) to service_role",
    );
  });
});

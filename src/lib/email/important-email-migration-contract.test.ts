import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  "supabase/migrations/20261125120000_important_email_notifications.sql",
  "utf8",
);
const migration = raw.replaceAll("\r\n", "\n");

describe("important email migration contract", () => {
  it("is additive, LF-safe, and avoids forbidden qualified special forms", () => {
    expect(raw).not.toContain("\r");
    expect(migration).not.toMatch(/create or replace function/);
    expect(migration).not.toMatch(/pg_catalog\.(least|greatest|coalesce|nullif)/i);
    expect(migration).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(migration.slice(0, migration.indexOf("create table"))).toContain(
      "current_user <> 'postgres'",
    );
    expect(migration.slice(0, migration.indexOf("create table"))).not.toContain(
      "session_user",
    );
    expect(migration).toContain("if session_user <> 'postgres' then");
  });

  it("pins the three types, notification dedupe, priority, caps, and stale limit", () => {
    expect(migration).toContain("notification_id uuid not null unique");
    expect(migration).toContain("'assignment', 'task_due_soon', 'live_operation_prep'");
    expect(migration).toContain("p_limit not between 1 and 10");
    expect(migration).toContain("daily_allowance between 1 and 70");
    expect(migration).toContain("new.created_at + interval '24 hours'");
    expect(migration).toContain("order by queue.priority, queue.created_at, queue.id");
  });

  it("keeps seed best-effort and preference missing-as-enabled", () => {
    expect(migration).toMatch(/seed_user_email_preference[\s\S]+exception when others then\n    null;/);
    expect(migration).toContain("A missing seed row is deliberately equivalent to the default-on state");
    expect(migration).toContain("on conflict (user_id) do update");
  });

  it("uses confirmed matching Auth email only without storing an address", () => {
    const queue = migration.slice(
      migration.indexOf("create table ceit_connect_private.email_delivery_queue"),
      migration.indexOf("create table ceit_connect_private.email_send_attempts"),
    );
    expect(queue).not.toMatch(/\bemail\b/i);
    expect(migration).toContain("auth_user.email_confirmed_at is not null");
    expect(migration).toContain("profile.anonymized_at is null");
    expect(migration).toContain("auth_user.email::text as out_recipient_email");
  });

  it("authenticates claim/ack before validation and locks", () => {
    for (const signature of ["claim_email_deliveries", "acknowledge_email_delivery"]) {
      const body = migration.slice(migration.indexOf(`create function public.${signature}`));
      expect(body.indexOf("authenticate_email_sender()")).toBeLessThan(body.indexOf("for update"));
    }
    expect(migration).toContain("p_lease_token is null or p_outcome is null");
  });

  it("pins no-work/no-wake, allowance no-wake, and hourly count throttling", () => {
    expect(migration).toContain("allowance_reached_count integer");
    expect(migration).toContain("no email delivery is due or the Manila-day allowance is exhausted");
    const kick = migration.slice(migration.indexOf("create function ceit_connect_private.request_email_kick_if_due"));
    expect(kick.indexOf("if not exists")).toBeLessThan(kick.indexOf("vault.decrypted_secrets"));
    expect(kick.indexOf("if not exists")).toBeLessThan(kick.indexOf("net.http_post"));
    expect(kick.indexOf("if v_used >= v_allowance")).toBeLessThan(
      kick.indexOf("vault.decrypted_secrets"),
    );
    expect(kick.indexOf("if v_used >= v_allowance")).toBeLessThan(
      kick.indexOf("net.http_post"),
    );
    expect(migration).toContain("pg_catalog.date_trunc('hour', v_now)");
    expect(migration).toContain("run_row.allowance_reached_count = 1");
  });
});

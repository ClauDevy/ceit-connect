import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  "supabase/migrations/20261125120000_important_email_notifications.sql",
  "utf8",
);
const migration = raw.replaceAll("\r\n", "\n");
const worker = readFileSync("src/lib/email/important-email-worker.ts", "utf8").replaceAll("\r\n", "\n");
const sender = readFileSync("src/lib/email/resend-sender.ts", "utf8").replaceAll("\r\n", "\n");

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
    expect(migration).toContain("notification_id uuid unique");
    expect(migration).toContain("references public.notifications(id) on delete set null");
    expect(migration).toContain("task_id uuid not null references public.tasks(id) on delete cascade");
    expect(migration).toContain("'assignment', 'task_due_soon', 'live_operation_prep'");
    expect(migration).toContain("p_limit not between 1 and 10");
    expect(migration).toContain("daily_allowance between 1 and 70");
    expect(migration).toContain("new.created_at + interval '24 hours'");
    expect(migration).toContain("order by queue.priority, queue.created_at, queue.id");
    expect(migration).toContain("order by leased.priority, leased.created_at, leased.id");
  });

  it("keeps seed best-effort and preference missing-as-enabled", () => {
    expect(migration).toMatch(/seed_user_email_preference[\s\S]+exception when others then\n    null;/);
    expect(migration).toContain("A missing seed row is deliberately equivalent to the default-on state");
    expect(migration).toContain("on conflict (user_id) do update");
  });

  it("uses confirmed matching Auth email only without storing an address", () => {
    const queue = migration.slice(
      migration.indexOf("create table ceit_connect_private.email_delivery_queue"),
      migration.indexOf("create function ceit_connect_private.guard_task_email_send_content"),
    );
    expect(queue).not.toMatch(/\bemail\b/i);
    expect(migration).toContain("auth_user.email_confirmed_at is not null");
    expect(migration).toContain("profile.anonymized_at is null");
    expect(migration).toContain("auth_user.email::text as out_recipient_email");
    expect(migration).toContain("create function public.prepare_email_delivery");
    expect(migration).toContain("public.task_content_access_for_user(task_row.id, guarded.user_id) <> 'real'");
    expect(migration).toContain("create trigger tasks_y9_guard_email_send_content");
    expect(migration).toContain("queue.send_guard_until > pg_catalog.clock_timestamp()");
    expect(migration).toContain("where queue.task_id = old.id");
  });

  it("keeps quota reservations after queue deletion and caps both accounting windows", () => {
    const attempts = migration.slice(
      migration.indexOf("create table ceit_connect_private.email_send_attempts"),
      migration.indexOf("create table ceit_connect_private.email_delivery_runs"),
    );
    expect(attempts).not.toContain("references ceit_connect_private.email_delivery_queue");
    expect(migration).toContain("attempt.reserved_at > v_now - interval '24 hours'");
    expect(migration.match(/attempt\.reserved_at > v_now - interval '24 hours'/g)).toHaveLength(2);
    expect(migration).toContain("attempt.reserved_at < p_as_of - interval '48 hours'");
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
    expect(migration).toContain(
      "no email delivery is due or the Manila-day or rolling-24-hour allowance is exhausted",
    );
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
    expect(kick.indexOf("purge_email_delivery_history(v_now)")).toBeLessThan(
      kick.indexOf("if not exists"),
    );
  });

  it("cleans abandoned runs without deleting recent unfinished runs", () => {
    expect(migration).toContain("run_row.finished_at is null");
    expect(migration).toContain("run_row.started_at < p_as_of - interval '30 days'");
    expect(migration).toContain("order by coalesce(run_row.finished_at, run_row.started_at)");
  });

  it("revalidates immediately before send and records run-finalization failures", () => {
    expect(worker).toContain('client.rpc("prepare_email_delivery"');
    expect(worker.indexOf("prepareDelivery(client, delivery)")).toBeLessThan(
      worker.indexOf("sendResendEmail(config.apiKey"),
    );
    expect(worker).toContain("finalizationFailures: 0");
    expect(worker).toContain("if (error || data !== true) counts.finalizationFailures += 1");
    expect(worker).toContain("const body = await response.arrayBuffer()");
    expect(worker).toContain("Date.now() + RESEND_TIMEOUT_MS");
  });

  it("serializes task content before publishing the send guard", () => {
    const preparation = migration.slice(migration.indexOf("create function public.prepare_email_delivery"));
    expect(preparation.indexOf("for share")).toBeLessThan(
      preparation.indexOf("set send_guard_until"),
    );
    expect(preparation.indexOf("v_now := pg_catalog.clock_timestamp()"))
      .toBeLessThan(preparation.indexOf("set send_guard_until"));
    expect(preparation).toContain("join public.tasks as task_row on task_row.id = guarded.task_id");
  });

  it("classifies only Resend's concurrent idempotency conflict as retryable", () => {
    expect(sender).toContain('status === 409 && errorName === "concurrent_idempotent_requests"');
    expect(sender).toContain("resendErrorName(body)");
  });
});

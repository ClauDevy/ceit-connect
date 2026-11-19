import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const raw = readFileSync(
  "supabase/migrations/20261125120000_important_email_notifications.sql",
  "utf8",
);
const migration = raw.replaceAll("\r\n", "\n");
const correctiveRaw = readFileSync(
  "supabase/migrations/20261126120000_email_queue_drop_task_fk.sql",
  "utf8",
);
const correctiveMigration = correctiveRaw.replaceAll("\r\n", "\n");
const worker = readFileSync("src/lib/email/important-email-worker.ts", "utf8").replaceAll("\r\n", "\n");
const sender = readFileSync("src/lib/email/resend-sender.ts", "utf8").replaceAll("\r\n", "\n");

function definition(source: string, create: string, alter: string) {
  return source.slice(source.indexOf(create), source.indexOf(alter));
}

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
    expect(correctiveMigration).toContain(
      "drop constraint if exists email_delivery_queue_task_id_fkey",
    );
    expect(correctiveMigration).toContain(
      "create index if not exists email_delivery_queue_task_id_idx",
    );
    expect(migration).toContain("'assignment', 'task_due_soon', 'live_operation_prep'");
    expect(migration).toContain("p_limit not between 1 and 10");
    expect(migration).toContain("daily_allowance between 1 and 70");
    expect(migration).toContain("new.created_at + interval '24 hours'");
    expect(migration).toContain("order by queue.priority, queue.created_at, queue.id");
    expect(migration).toContain("order by leased.priority, leased.created_at, leased.id");
  });

  it("ends with no email foreign key to events or tasks", () => {
    expect(correctiveRaw).not.toContain("\r");
    expect(correctiveMigration.match(/create or replace function/g)).toHaveLength(2);
    const beforeReplacements = correctiveMigration.slice(
      0,
      correctiveMigration.indexOf("create or replace function"),
    );
    expect(beforeReplacements).not.toContain("session_user");
    expect(correctiveMigration.slice(0, correctiveMigration.indexOf("do $$", 1))).toContain(
      "current_user <> 'postgres'",
    );
    expect(correctiveMigration).toContain(
      "source_namespace.nspname = 'ceit_connect_private'",
    );
    expect(correctiveMigration).toContain("source_class.relname = 'email_delivery_queue'");
    expect(correctiveMigration).toContain("source_class.relname::text like 'email\\_%'");
    expect(correctiveMigration).toContain("source_class.relname = 'user_email_preferences'");
    expect(correctiveMigration).toContain(
      "constraint_row.confrelid = 'public.tasks'::regclass",
    );
    expect(correctiveMigration).toContain(
      "constraint_row.confrelid in (\n      'public.events'::regclass,\n      'public.tasks'::regclass\n    )",
    );
  });

  it("requires the event-delete FK count to equal its exact inventory", () => {
    expect(correctiveMigration).toContain(
      "from ceit_connect_private.event_delete_fk_lock_list",
    );
    expect(correctiveMigration).toContain("if v_actual_count <> v_expected_count then");
    expect(correctiveMigration).toContain(
      "Event deletion foreign-key inventory count mismatch.",
    );
  });

  it("changes only the approved stale predicate in the applied claim body", () => {
    const oldClaim = definition(
      migration,
      "create function public.claim_email_deliveries",
      "alter function public.claim_email_deliveries",
    );
    const newClaim = definition(
      correctiveMigration,
      "create or replace function public.claim_email_deliveries",
      "alter function public.claim_email_deliveries",
    );
    const normalizedClaim = newClaim
      .replace("create or replace function", "create function")
      .replace(
        "where (queue.state = 'pending' and queue.stale_at <= v_now)\n"
          + "     or (queue.state = 'leased'\n"
          + "         and queue.lease_expires_at <= v_now\n"
          + "         and queue.stale_at <= v_now);",
        "where queue.state in ('pending', 'leased') and queue.stale_at <= v_now;",
      );
    expect(normalizedClaim).toBe(oldClaim);
  });

  it("adds only the two approved bounded stages to the applied purge body", () => {
    const oldPurge = definition(
      migration,
      "create function ceit_connect_private.purge_email_delivery_history",
      "alter function ceit_connect_private.purge_email_delivery_history",
    );
    const newPurge = definition(
      correctiveMigration,
      "create or replace function ceit_connect_private.purge_email_delivery_history",
      "alter function ceit_connect_private.purge_email_delivery_history",
    );
    const addedStart = newPurge.indexOf("  with stale as (");
    const existingDeletes = newPurge.indexOf("  with doomed as (");
    expect(addedStart).toBeGreaterThanOrEqual(0);
    expect(existingDeletes).toBeGreaterThan(addedStart);
    const addedStages = newPurge.slice(addedStart, existingDeletes);
    expect(addedStages.match(/limit 500 for update skip locked/g)).toHaveLength(2);
    expect(addedStages).toContain("queue.lease_expires_at <= p_as_of");
    expect(addedStages).toContain("from public.tasks as task_row");
    expect(addedStages).toContain("from orphaned where queue.id = orphaned.id");
    const normalizedPurge = (
      newPurge.slice(0, addedStart) + newPurge.slice(existingDeletes)
    ).replace("create or replace function", "create function");
    expect(normalizedPurge).toBe(oldPurge);
    expect(correctiveMigration).toContain(
      "alter function ceit_connect_private.purge_email_delivery_history(timestamptz)\n"
        + "owner to postgres;\n"
        + "revoke all on function ceit_connect_private.purge_email_delivery_history(timestamptz)\n"
        + "from public, anon, authenticated, service_role;",
    );
    expect(correctiveMigration).toContain(
      "alter function public.claim_email_deliveries(integer) owner to postgres;\n"
        + "revoke all on function public.claim_email_deliveries(integer)\n"
        + "from public, authenticated, service_role;\n"
        + "grant execute on function public.claim_email_deliveries(integer) to anon;",
    );
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
    const shareLock = preparation.indexOf("for share");
    const refreshedClock = preparation.indexOf("v_now := pg_catalog.clock_timestamp()");
    const sendGuard = preparation.indexOf("set send_guard_until");
    expect(shareLock).toBeGreaterThanOrEqual(0);
    expect(sendGuard).toBeGreaterThanOrEqual(0);
    expect(shareLock).toBeLessThan(sendGuard);
    expect(refreshedClock).toBeGreaterThanOrEqual(0);
    expect(sendGuard).toBeGreaterThanOrEqual(0);
    expect(refreshedClock).toBeLessThan(sendGuard);
    expect(preparation).toContain("join public.tasks as task_row on task_row.id = guarded.task_id");
  });

  it("retries concurrent or unreadable 409 without broadening unreadable 4xx", () => {
    expect(sender).toContain(
      'status === 409\n    && (bodyUnreadable || errorName === "concurrent_idempotent_requests")',
    );
    expect(sender).toContain("resendErrorName(body), bodyUnreadable");
    expect(sender).toContain("if (status === 429 || status >= 500)");
  });
});

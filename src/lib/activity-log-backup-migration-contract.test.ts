import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const foundation = readFileSync(join(root,
  "supabase/migrations/20261127120000_activity_log_backup_foundation.sql"), "utf8").replaceAll("\r\n", "\n");
const worker = readFileSync(join(root,
  "supabase/migrations/20261128120000_activity_log_backup_worker.sql"), "utf8").replaceAll("\r\n", "\n");
const personPayloadMigration = readFileSync(join(root,
  "supabase/migrations/20261129120000_activity_log_person_payload_retention_and_cleared.sql"), "utf8").replaceAll("\r\n", "\n");
const testPaste = readFileSync(join(root,
  "docs/phase-5/step-e2-activity-log-backup-clearing-tests.md"), "utf8").replaceAll("\r\n", "\n");
const rollout = readFileSync(join(root,
  "docs/phase-5/step-e2-activity-log-backup-clearing.md"), "utf8").replaceAll("\r\n", "\n");
const appWorker = readFileSync(join(root,
  "src/lib/activity-log-backup-worker.ts"), "utf8").replaceAll("\r\n", "\n");

function extractPublicFunctionBody(name: string) {
  const start = worker.indexOf(`create function public.${name}`);
  if (start < 0) return null;
  const bodyStart = worker.indexOf("\nas $$\n", start);
  if (bodyStart < 0) return null;
  const bodyEnd = worker.indexOf("\n$$;", bodyStart + 7);
  if (bodyEnd < 0) return null;
  return worker.slice(bodyStart + 7, bodyEnd);
}

describe("Batch E2 Activity Log backup migration contract", () => {
  it("adds the strict person payload branches after the prior migrations", () => {
    expect(personPayloadMigration).toContain("if current_user <> 'postgres'");
    expect(personPayloadMigration).toContain("drop constraint activity_log_person_payload_check");
    expect(personPayloadMigration).toContain("add constraint activity_log_person_payload_check");
    expect(personPayloadMigration).toContain("activity_type not in (\n            'activity_log_retention_changed',\n            'activity_log_cleared'");
    expect(personPayloadMigration).toContain("activity_type = 'activity_log_retention_changed'");
    expect(personPayloadMigration).toContain("changes ?& array['old_days', 'new_days']");
    expect(personPayloadMigration).toContain("(changes - 'old_days' - 'new_days') = '{}'::jsonb");
    expect(personPayloadMigration).toContain("activity_type = 'activity_log_cleared'");
    expect(personPayloadMigration).toContain("changes ?& array['count', 'backup_id', 'cutoff_at']");
    expect(personPayloadMigration).toContain("(changes - 'count' - 'backup_id' - 'cutoff_at') = '{}'::jsonb");
    expect(personPayloadMigration).toContain("pg_catalog.jsonb_typeof(changes -> 'count') = 'number'");
    expect(personPayloadMigration).toContain("pg_catalog.jsonb_typeof(changes -> 'backup_id') = 'string'");
    expect(personPayloadMigration).toContain("pg_catalog.jsonb_typeof(changes -> 'cutoff_at') = 'string'");
    expect(personPayloadMigration).not.toContain("jsonb_object_length");
    expect(personPayloadMigration).toContain("changes ->> 'target_role' in ('Admin', 'Co-Admin', 'Member')");
    expect(personPayloadMigration).not.toContain("service_role");
  });
  it("creates a private capped CSV bucket and only the two exact policies", () => {
    expect(foundation).toContain("'activity-log-backups',\n  'activity-log-backups',\n  false,\n  5242880");
    expect(foundation).toContain("array['text/csv']::text[]");
    expect(foundation.match(/create policy /g)).toHaveLength(2);
    expect(foundation).toContain('create policy "Activity backup worker can upload reserved CSV"');
    expect(foundation).toContain("on storage.objects for insert\nto anon");
    expect(foundation).toContain('create policy "Active Admins can read Activity Log backups"');
    expect(foundation).toContain("on storage.objects for select\nto authenticated");
    expect(foundation).not.toContain("can_worker_read_activity_log_backup_object");
    expect(foundation).not.toContain("on storage.objects for select\nto anon");
    expect(foundation).not.toMatch(/on storage\.objects for (update|delete)/i);
  });

  it("denies Co-Admins and Members at the Admin Storage helper", () => {
    const helper = foundation.slice(foundation.indexOf("create function public.is_active_activity_log_backup_admin"));
    expect(helper).toContain("profile.is_active\n      and profile.role = 'Admin'");
    expect(helper).toContain("grant execute on function public.is_active_activity_log_backup_admin()\nto authenticated");
  });

  it("keeps exact manifests private with no event or task foreign key", () => {
    expect(foundation).toContain("activity_id uuid not null");
    expect(foundation).not.toMatch(/references public\.(events|tasks)/);
    expect(worker).toContain("log_row.task_title_snapshot");
    expect(foundation).toContain("'activity_log_retention_changed', 'UPDATE', 'person'");
    expect(foundation).toContain("'activity_log_cleared', 'DELETE', 'person'");
  });

  it("keeps file payload bytes private, capped, and API-ungranted", () => {
    expect(foundation).toContain("create table ceit_connect_private.activity_log_backup_file_payloads");
    expect(foundation).toContain("references ceit_connect_private.activity_log_backup_files(id) on delete cascade");
    expect(foundation).toContain("pg_catalog.octet_length(file_bytes) between 1 and 5242880");
    expect(foundation).toContain("alter table ceit_connect_private.activity_log_backup_file_payloads owner to postgres");
    expect(foundation).toContain("alter table ceit_connect_private.activity_log_backup_file_payloads enable row level security");
    expect(foundation).toContain("revoke all on table ceit_connect_private.activity_log_backup_file_payloads\nfrom public, anon, authenticated, service_role");
  });

  it("allows only one unfinished backup and gives the fixed clear message", () => {
    expect(foundation).toContain("activity_log_backups_one_active_key");
    expect(worker).toContain("Another Activity Log backup is still in progress.");
    expect(worker).not.toContain("'email_failed'\n);");
  });

  it("spaces retries, fails only unfinished snapshots, and lets failed backups unblock", () => {
    expect(foundation).toContain("attempt_count integer not null default 0");
    expect(foundation).toContain("next_attempt_at timestamptz not null default pg_catalog.clock_timestamp()");
    const stale = worker.slice(
      worker.indexOf("create function ceit_connect_private.fail_stale_activity_log_snapshots"),
      worker.indexOf("create function ceit_connect_private.assert_no_active_activity_log_backup"),
    );
    expect(stale).toContain("backup.status in ('pending', 'snapshotting')");
    expect(stale).toContain("backup.attempt_count >= 5");
    expect(stale).toContain("interval '24 hours'");
    expect(stale).toContain("'snapshot_attempts_exhausted'");
    expect(stale).toContain("'snapshot_expired'");
    const activeIndex = foundation.slice(
      foundation.indexOf("create unique index activity_log_backups_one_active_key"),
      foundation.indexOf("create table ceit_connect_private.activity_log_backup_files"),
    );
    expect(activeIndex).not.toContain("'failed'");
    expect(worker).toContain("and backup.next_attempt_at <= v_now");
    expect(worker).toContain("and backup.next_attempt_at <= pg_catalog.clock_timestamp()");
  });

  it("never fails deletion open and exposes only fixed safe retry codes", () => {
    const release = worker.slice(
      worker.indexOf("create function public.release_activity_log_backup_lease"),
      worker.indexOf("create function ceit_connect_private.request_activity_log_backup_kick_if_due"),
    );
    expect(release).toContain("v_backup.status in ('deletion_requested', 'deleting')");
    expect(release).toContain("last_error_code = 'deletion_retry_pending'");
    expect(release).not.toContain("pg_catalog.left(p_error_code");
    expect(release).not.toMatch(/delet[^\n]*then 'failed'/);
    expect(release).toContain("when 1 then interval '5 minutes'");
    expect(release).toContain("when 2 then interval '15 minutes'");
    expect(release).toContain("when 3 then interval '60 minutes'");
    expect(release).toContain("else interval '240 minutes'");
  });

  it("uses bounded important-email spacing before terminal email failure", () => {
    const acknowledgement = worker.slice(
      worker.indexOf("create function public.acknowledge_activity_log_backup_email"),
      worker.indexOf("create function public.release_activity_log_backup_lease"),
    );
    expect(acknowledgement).toContain("v_attempts + 1 >= 5");
    expect(acknowledgement).toContain("if p_outcome is null");
    expect(acknowledgement).toContain("when 1 then interval '5 minutes'");
    expect(acknowledgement).toContain("when 2 then interval '15 minutes'");
    expect(acknowledgement).toContain("when 3 then interval '60 minutes'");
    expect(acknowledgement).toContain("else interval '240 minutes'");
    expect(acknowledgement).toContain("then 'email_failed'");
    expect(worker).toContain("set status = 'email_pending', email_attempt_count = 0");
  });

  it("keeps the monthly checker idempotent before and after its advisory lock", () => {
    const monthly = worker.slice(
      worker.indexOf("create function ceit_connect_private.start_monthly_activity_log_backup"),
      worker.indexOf("create function public.create_activity_log_manual_backup"),
    );
    expect(monthly.match(/backup\.cycle_month = v_cycle/g)).toHaveLength(2);
    const advisoryLock = monthly.indexOf("pg_advisory_xact_lock");
    expect(advisoryLock).toBeGreaterThanOrEqual(0);
    expect(advisoryLock).toBeLessThan(
      monthly.lastIndexOf("backup.cycle_month = v_cycle"),
    );
    expect(monthly).toContain("if found then return v_backup_id; end if;");
    expect(foundation).toContain("activity_log_backups_cycle_month_key");
  });

  it("authenticates every anon worker before validation and locks", () => {
    for (const name of [
      "claim_activity_log_backup",
      "list_activity_log_backup_candidates",
      "reserve_activity_log_backup_file",
      "verify_activity_log_backup_file",
      "complete_activity_log_backup_snapshot",
      "run_activity_log_backup_delete_batch",
      "prepare_activity_log_backup_email",
      "read_activity_log_backup_file_payload",
      "acknowledge_activity_log_backup_email",
      "release_activity_log_backup_lease",
    ]) {
      const extracted = extractPublicFunctionBody(name);
      expect(extracted, `${name} body extraction`).not.toBeNull();
      const body = extracted ?? "";
      expect(body.indexOf("authenticate_email_sender()")).toBeGreaterThanOrEqual(0);
      const validation = body.indexOf("if p_");
      const lock = body.indexOf("for update");
      if (validation >= 0) expect(body.indexOf("authenticate_email_sender()")).toBeLessThan(validation);
      if (lock >= 0) expect(body.indexOf("authenticate_email_sender()")).toBeLessThan(lock);
      expect(body).toContain("Activity Log backup worker authentication failed.");
    }
  });

  it("rejects an unauthenticated immediate-return shape in the claim body check", () => {
    const extracted = extractPublicFunctionBody("claim_activity_log_backup");
    expect(extracted).not.toBeNull();
    const claimBody = extracted ?? "";
    const authenticatesBeforeReturn = (body: string) => {
      const authentication = body.indexOf("authenticate_email_sender()");
      const returnQuery = body.indexOf("return query");
      return authentication >= 0 && returnQuery >= 0 && authentication < returnQuery;
    };
    expect(authenticatesBeforeReturn(claimBody)).toBe(true);
    const unauthenticatedImmediateReturn = claimBody.replace(
      "begin\n",
      "begin\n  return query select null;\n",
    );
    expect(authenticatesBeforeReturn(unauthenticatedImmediateReturn)).toBe(false);
  });

  it("requires a live completion lease and allocates the next maximum part", () => {
    const completion = extractPublicFunctionBody("complete_activity_log_backup_snapshot");
    expect(completion).not.toBeNull();
    expect(completion).toContain("backup.lease_expires_at > pg_catalog.clock_timestamp()");
    const reservation = extractPublicFunctionBody("reserve_activity_log_backup_file");
    expect(reservation).not.toBeNull();
    expect(reservation).toContain(
      "select COALESCE(pg_catalog.max(file_row.part_number), 0) + 1 into v_part",
    );
    expect(reservation).not.toContain("select pg_catalog.count(*)::integer + 1 into v_part");
  });

  it("verifies and serves payload bytes without worker Storage reads", () => {
    const verification = worker.slice(
      worker.indexOf("create function public.verify_activity_log_backup_file"),
      worker.indexOf("create function public.complete_activity_log_backup_snapshot"),
    );
    expect(verification).toContain("p_file_bytes_base64 text");
    expect(verification).toContain("pg_catalog.decode(p_file_bytes_base64, 'base64')");
    expect(verification).toContain("pg_catalog.octet_length(v_file_bytes) <> p_raw_byte_count");
    expect(verification).toContain("extensions.digest(v_file_bytes, 'sha256')");
    expect(verification).toContain("v_storage_size is distinct from p_raw_byte_count");
    expect(verification).toContain("insert into ceit_connect_private.activity_log_backup_file_payloads");
    const reader = worker.slice(
      worker.indexOf("create function public.read_activity_log_backup_file_payload"),
      worker.indexOf("create function public.acknowledge_activity_log_backup_email"),
    );
    expect(reader).toContain("backup.status = 'email_pending'");
    expect(reader).toContain("file_row.id = p_file_id and file_row.status = 'verified'");
    expect(reader).toContain("pg_catalog.encode(payload.file_bytes, 'base64')");
    expect(appWorker).not.toContain(".download(");
    expect(appWorker).toContain('client.rpc("read_activity_log_backup_file_payload"');
    expect(appWorker).toContain('p_file_bytes_base64: Buffer.from(csv.bytes).toString("base64")');
  });

  it("deletes payload bytes only when a backup completes or fails", () => {
    const cleanup = worker.slice(
      worker.indexOf("create function ceit_connect_private.cleanup_activity_log_backup_file_payloads"),
      worker.indexOf("create function ceit_connect_private.fail_stale_activity_log_snapshots"),
    );
    expect(cleanup).toContain("new.status in ('completed', 'failed')");
    expect(cleanup).not.toContain("'email_failed'");
    expect(cleanup).toContain("delete from ceit_connect_private.activity_log_backup_file_payloads");
    expect(cleanup).toContain("after update of status on ceit_connect_private.activity_log_backups");
  });

  it("has one private ungranted marker setter and exact verified-manifest deletion", () => {
    expect(worker.match(/'ceit_connect\.activity_log_purger'/g)).toHaveLength(3);
    const deletion = worker.slice(worker.indexOf(
      "create function ceit_connect_private.delete_activity_log_backup_manifest_batch"),
      worker.indexOf("create function public.run_activity_log_backup_delete_batch"),
    );
    expect(deletion).toContain("backup.status = 'deleting'");
    expect(deletion).toContain("file_row.status <> 'verified'");
    expect(deletion).toContain("manifest.activity_id");
    expect(deletion).toContain("limit 5000");
    expect(deletion).toContain("revoke all on function ceit_connect_private.delete_activity_log_backup_manifest_batch(uuid)");
    expect(deletion).not.toContain("grant execute");
    expect(foundation.slice(foundation.indexOf("create or replace function public.purge_activity_log")))
      .not.toContain("activity_log_purger");
  });

  it("locks and validates deletion lease ownership before invoking the private batch", () => {
    const runner = worker.slice(
      worker.indexOf("create function public.run_activity_log_backup_delete_batch"),
      worker.indexOf("create function public.prepare_activity_log_backup_email"),
    );
    const lock = runner.indexOf("for update");
    const leaseValidation = runner.indexOf("v_backup.lease_token is distinct from p_lease_token");
    const deletion = runner.indexOf("delete_activity_log_backup_manifest_batch(p_backup_id)");
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(leaseValidation).toBeGreaterThan(lock);
    expect(deletion).toBeGreaterThan(leaseValidation);
    expect(runner).toContain("v_backup.lease_expires_at <= pg_catalog.clock_timestamp()");
  });

  it("uses viewer-independent confidential masking and never returns raw changes", () => {
    const reader = worker.slice(worker.indexOf("create function public.list_activity_log_backup_candidates"),
      worker.indexOf("create function public.reserve_activity_log_backup_file"));
    expect(reader).toContain("then 'Confidential Task'");
    expect(reader).toContain("then 'Confidential Task activity'");
    expect(reader).toContain("then null");
    expect(reader).not.toContain("log_row.changes as");
    expect(reader).not.toContain("task_row.description");
  });

  it("keeps same-shape same-value setter and retires unbacked purge", () => {
    expect(foundation).toContain("returns table (\n  retention_days integer,\n  updated_at timestamptz,\n  updated_by uuid");
    expect(foundation).toContain("if v_setting.retention_days is distinct from p_retention_days then");
    expect(foundation).toContain("'old_days', v_old_days");
    expect(foundation).toContain("return query\n  select v_setting.retention_days, v_setting.updated_at, v_setting.updated_by");
    const purge = foundation.slice(foundation.indexOf("create or replace function public.purge_activity_log"));
    expect(purge).toContain("if session_user <> 'postgres'");
    expect(purge).toContain("return 0;");
  });

  it("adds no cron or Vault mutation and supplies private scheduler helpers", () => {
    expect(foundation + worker).not.toContain("cron.schedule");
    expect(foundation + worker).not.toContain("vault.create_secret");
    expect(worker).toContain("start_monthly_activity_log_backup()");
    expect(worker).toContain("request_email_and_activity_backup_kicks_if_due()");
  });

  it("pins retry, activity-type, monthly-repeat, and seven-day catch-up owner proofs", () => {
    expect(testPaste).toContain("snapshot_attempts_exhausted");
    expect(testPaste).toContain("snapshot_expired");
    expect(testPaste).toContain("v_first is not distinct from v_second");
    expect(testPaste).toContain("activity_type = 'activity_log_retention_changed'");
    expect(testPaste).toContain("activity_type = 'activity_log_cleared'");
    expect(testPaste).toContain("40 requesting Admin is inactive before final deletion batch");
    expect(testPaste).toContain("candidate.change_summary is null");
    expect(testPaste).toContain("34g legacy NULL summary is covered and completes");
    expect(testPaste).toContain("TEST RESULTS %/67 PASS");
    expect(rollout).toContain("'0 0 1-7 * *'");
    expect(rollout).toContain("exactly_seven_prod_jobs");
  });
});

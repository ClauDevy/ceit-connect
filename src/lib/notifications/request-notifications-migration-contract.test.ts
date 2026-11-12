import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readText = (path: string) =>
  readFileSync(path, "utf8").replace(/\r\n/g, "\n");

const migrationPath =
  "supabase/migrations/20261115120000_request_notifications.sql";
const migration = readText(migrationPath);
const catalogPaste = readText(
  "docs/phase-5/step-r1-request-notifications-catalog-tests.md",
);
const behaviorPaste = readText(
  "docs/phase-5/step-r1-request-notifications-behavior-tests.md",
);
const step = readText("docs/phase-5/step-r1-request-notifications.md");
const migrationFiles = readdirSync("supabase/migrations")
  .filter((name) => name.endsWith(".sql"))
  .sort();

const requestTypes = [
  "volunteer_offer",
  "leave_requested",
  "leave_cancelled",
  "leave_approved",
  "leave_denied",
] as const;

describe("Phase 5 R1 request-notification migration contract", () => {
  it("uses a new timestamp after the documented Dev and Prod tip", () => {
    const executiveDashboardMigration =
      "20261114120000_executive_dashboard_extras_data.sql";
    const requestNotificationsMigration =
      "20261115120000_request_notifications.sql";

    expect(migrationFiles.indexOf(executiveDashboardMigration)).toBeGreaterThanOrEqual(0);
    expect(migrationFiles.indexOf(requestNotificationsMigration)).toBeGreaterThanOrEqual(0);
    expect(migrationFiles.indexOf(executiveDashboardMigration)).toBeLessThan(
      migrationFiles.indexOf(requestNotificationsMigration),
    );
  });

  it("adds all five types to storage, insertion, and push delivery", () => {
    for (const type of requestTypes) {
      expect(migration.match(new RegExp(`'${type}'`, "g"))?.length).toBeGreaterThanOrEqual(3);
    }
    expect(migration).toContain("add constraint notifications_type_check check");
    expect(migration).toContain(
      "add constraint push_delivery_queue_notification_type_check check",
    );
    expect(migration).toContain(
      "create or replace function ceit_connect_private.insert_notifications(",
    );
    expect(migration).toContain(
      "create or replace function public.claim_push_deliveries(p_limit integer default 50)",
    );
  });

  it("keeps recipients active, actor-excluded, and confidential-safe", () => {
    expect(migration).toContain("profile.is_active is true");
    expect(migration).toContain("proposed.user_id is distinct from p_actor_id");
    expect(migration).toContain(
      "public.task_content_access_for_user(new.task_id, profile.id) = 'real'",
    );
    expect(migration).toContain("profile.role = 'Admin'");
    expect(migration).toContain(
      "profile.role = 'Co-Admin' and profile.committee_id = v_committee_id",
    );
    expect(migration).toContain("profile.id = any(v_primary_assignees)");
    expect(migration).not.toMatch(/leased\.(?:task_id|task_title|user_name|full_name)/);
  });

  it("keeps new trigger functions private without a service-role exception", () => {
    for (const name of [
      "notify_task_volunteer_offer()",
      "notify_task_leave_request()",
    ]) {
      expect(migration).toContain(`alter function ceit_connect_private.${name} owner to postgres`);
      expect(migration).toContain(
        `revoke all on function ceit_connect_private.${name}\nfrom public, anon, authenticated, service_role`,
      );
    }
    expect(migration).not.toMatch(/grant execute[^;]*service_role/i);
  });

  it("preserves approval suppression through deterministic trigger ordering", () => {
    expect(migration).toContain(
      "create trigger task_leave_requests_z8_request_notifications",
    );
    expect(
      "task_leave_requests_z8_notification_suppression" <
        "task_leave_requests_z8_request_notifications",
    ).toBe(true);
    expect(step).toContain(
      "`task_leave_requests_z8_notification_suppression`",
    );
    expect(step).toContain("`task_leave_requests_z8_request_notifications`");
    expect(behaviorPaste).toContain(
      "approval creates the requester outcome despite suppression trigger",
    );
    expect(behaviorPaste).toContain(
      "approval suppresses assignee-removal status notification",
    );
    expect(behaviorPaste).toContain("approval suppression marker is consumed");
  });

  it("keeps no-op, repeated, withdrawal, and system closures silent", () => {
    expect(migration).toContain("new.stale_reason is null");
    expect(migration).toContain("if new.status is distinct from 'pending' then");
    expect(migration).toContain("elsif tg_op = 'UPDATE'");
    expect(migration).toContain("old.status = 'pending'");
    expect(migration).toContain("after insert on public.task_volunteers");
    expect(migration).not.toMatch(/after\s+delete\s+on\s+public\.task_volunteers/i);
    for (const label of [
      "failed double submission creates nothing",
      "volunteer withdrawal is silent",
      "backup cancellation itself is silent",
      "cancel after approval creates nothing",
      "system-driven closure emits no cancellation notification",
    ]) {
      expect(behaviorPaste).toContain(label);
    }
  });

  it("pins the self-contained Dev pastes and their finished ledgers", () => {
    for (const paste of [catalogPaste, behaviorPaste]) {
      expect(paste).toContain("Run without RLS");
      expect(paste).toContain("insert into auth.users");
      expect(paste).toMatch(/set_config\(\s*'request\.jwt\.claims'/);
      expect(paste).not.toMatch(/create\s+(?:temporary|temp)\s+table/i);
      expect(paste).not.toContain("\\gset");
    }
    expect(catalogPaste).toContain("records exactly **25** result rows");
    expect(catalogPaste).toContain("TEST RESULTS 25/25 PASS");
    expect(behaviorPaste).toContain("records exactly **38** result rows");
    expect(behaviorPaste).toContain("TEST RESULTS 38/38 PASS");
    expect(behaviorPaste).toContain("non-pending leave INSERT succeeds silently");
  });

  it("documents both latest replacements side by side", () => {
    expect(step).toContain("## Latest replacements: old versus new");
    expect(step).toContain(
      "`ceit_connect_private.insert_notifications(text,uuid,uuid,uuid[])`",
    );
    expect(step).toContain("`public.claim_push_deliveries(integer)`");
    expect(step).toContain("No policy or public request/task writer is");
  });
});

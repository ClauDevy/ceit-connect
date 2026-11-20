import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const foundation = readFileSync(
  "supabase/migrations/20261110120000_notification_foundation.sql",
  "utf8",
).replaceAll("\r\n", "\n");
const reminders = readFileSync(
  "supabase/migrations/20261116120000_deadline_reminders.sql",
  "utf8",
).replaceAll("\r\n", "\n");
const pushFoundation = readFileSync(
  "supabase/migrations/20261112120000_web_push_database.sql",
  "utf8",
).replaceAll("\r\n", "\n");
const pushLatest = readFileSync(
  "supabase/migrations/20261120120000_alert_grouping.sql",
  "utf8",
).replaceAll("\r\n", "\n");

describe("important email upstream characterization", () => {
  it("keeps assignment generation in the existing task notification trigger", () => {
    expect(foundation).toContain("create trigger tasks_z8_notifications");
    expect(foundation).toContain(
      "'assignment', new.id, v_actor_id, v_assignment_ids",
    );
  });

  it("keeps both scheduled reminders as ordinary notification rows", () => {
    expect(reminders).toContain("'task_due_soon'::text as reminder_kind");
    expect(reminders).toContain("'live_operation_prep'::text");
    expect(reminders).toContain("insert into public.notifications");
  });

  it("keeps push attached independently to the same three notification types", () => {
    expect(pushLatest).toContain(
      "'assignment', 'task_due_soon', 'live_operation_prep', 'unlock'",
    );
    expect(pushFoundation).toContain(
      "create trigger notifications_z9_enqueue_push",
    );
    expect(pushLatest).toContain(
      "create or replace function ceit_connect_private.enqueue_notification_push()",
    );
  });
});

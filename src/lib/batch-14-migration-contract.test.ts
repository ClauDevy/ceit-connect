import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const privilegeMigration = readFileSync(
  "supabase/migrations/20261109120000_batch_14_privilege_and_run_history_hardening.sql",
  "utf8",
);
const visibilityMigration = readFileSync(
  "supabase/migrations/20261109121000_batch_14_inactive_event_visibility.sql",
  "utf8",
);
const capsMigration = readFileSync(
  "supabase/migrations/20261109122000_enable_officer_role_caps.sql",
  "utf8",
);
const batch14Paste = readFileSync(
  "docs/phase-4b/step-14-tests.md",
  "utf8",
);

describe("Batch 14 migration contracts", () => {
  it("pins the exact authenticated privilege baseline and result", () => {
    for (const table of [
      "public.events",
      "public.tasks",
      "public.notifications",
      "public.users",
      "public.activity_log",
    ]) {
      expect(privilegeMigration).toContain(table);
    }
    expect(privilegeMigration).toContain(
      "revoke truncate, references, trigger\non table public.events, public.tasks, public.notifications, public.activity_log",
    );
    expect(privilegeMigration).toContain(
      "revoke truncate, references, trigger\non table public.users",
    );
    expect(privilegeMigration).not.toContain(
      "revoke insert, delete, truncate, references, trigger",
    );
    expect(privilegeMigration).toContain(
      "authenticated table privileges differ from the owner-approved Dev/Prod preflight",
    );
    expect(privilegeMigration).toContain(
      "acl_row.grantor = 'postgres'::regrole::oid",
    );
    expect(privilegeMigration).toContain("if v_effective then");
    expect(privilegeMigration).toContain(
      "if not v_has_approved_direct or v_has_unapproved_direct then",
    );
    expect(privilegeMigration).toContain("elsif v_has_any_direct then");
    expect(privilegeMigration).toContain(
      "must be a direct non-grantable authenticated grant from postgres",
    );
    expect(privilegeMigration).toContain(
      "still has a direct authenticated ACL entry",
    );

    const initialMatrix = privilegeMigration.slice(
      privilegeMigration.indexOf("if not ("),
      privilegeMigration.indexOf("if exists ("),
    );
    for (const table of ["events", "tasks", "notifications", "users"]) {
      for (const privilege of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
        expect(initialMatrix).not.toContain(
          `and pg_catalog.has_table_privilege('authenticated', 'public.${table}', '${privilege}')`,
        );
      }
    }
    for (const privilege of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
      expect(initialMatrix).toContain(
        `and not pg_catalog.has_table_privilege('authenticated', 'public.activity_log', '${privilege}')`,
      );
    }
  });

  it("enables non-forced zero-policy RLS on both private run tables", () => {
    for (const table of [
      "event_auto_archive_runs",
      "event_auto_archive_run_items",
    ]) {
      expect(privilegeMigration).toContain(
        `alter table ceit_connect_private.${table}\nenable row level security;`,
      );
    }
    expect(privilegeMigration).not.toContain("force row level security");
    expect(privilegeMigration).not.toMatch(/create policy/i);
    expect(privilegeMigration).toContain(
      "array['anon', 'authenticated', 'service_role']",
    );
  });

  it("changes only the inactive branch of events_select and its mirror", () => {
    expect(visibilityMigration).toContain(
      "v_helper_definition like '%select p_event_status <> ''Draft''%'",
    );
    expect(visibilityMigration).toContain(
      "v_helper_definition not like '%select exists (%'",
    );
    expect(visibilityMigration).toContain(
      "public.my_role() is not null\n  and (\n    status <> 'Draft'\n    or public.my_role() in ('Admin', 'Co-Admin')",
    );
    expect(visibilityMigration).toContain(
      "create or replace function ceit_connect_private.activity_event_status_visible_for_user",
    );
    expect(visibilityMigration).toContain("and profile.is_active");
    expect(visibilityMigration).toContain(
      "or profile.role in ('Admin', 'Co-Admin')",
    );
  });

  it("enables exactly the keyed singleton setting in the latest migration", () => {
    expect(capsMigration).toContain(
      "update public.app_settings\n  set enforce_officer_role_caps = true\n  where key = 'global';",
    );
    expect(capsMigration).toContain("get diagnostics v_affected = row_count");
    expect(capsMigration).toContain("if v_affected <> 1 then");
    expect(capsMigration).not.toMatch(/update public\.users/i);
    expect(capsMigration).not.toMatch(/update public\.officer_invites/i);
  });

  it("pins the live deletion-inventory columns and activity-reader signature", () => {
    expect(batch14Paste).toContain(
      "constraint_name='event_phase_positions_event_id_fkey'",
    );
    expect(batch14Paste).toContain("referencing_schema='ceit_connect_private'");
    expect(batch14Paste).toContain("referencing_table='event_phase_positions'");
    expect(batch14Paste).toContain("referenced_table='events'");
    expect(batch14Paste).toContain("lock_kind='event_child_rows'");
    expect(batch14Paste).toContain("lock_order=90");
    expect(batch14Paste).toContain(
      "public.list_activity_log(uuid,text,text,uuid,date,date,text,timestamptz,uuid,integer)",
    );
    expect(batch14Paste).toContain("insert into auth.users (");
    expect(batch14Paste).toContain(
      "('b1400000-0000-4000-8000-000000000005'::uuid, 'b14-profileless@example.invalid')",
    );
    expect(batch14Paste.indexOf("insert into auth.users (")).toBeLessThan(
      batch14Paste.indexOf("insert into public.users(id,email"),
    );
    expect(batch14Paste).toContain(
      "string_agg(format('%s [%s]',test_name,detail),'; ' order by ordinal) filter(where not passed)",
    );
    expect(batch14Paste).toContain(
      "tgfoid='ceit_connect_private.capture_event_archive_snapshot()'::regprocedure",
    );
    expect(batch14Paste).toContain("like '%old.end_date is not null%'");
    expect(batch14Paste).toContain("like '%new.end_date is null%'");
    expect(batch14Paste).toContain("like '%errcode = ''CCD06''%'");
    expect(batch14Paste).not.toContain(
      "pg_get_functiondef('public.guard_event_updates()'::regprocedure) like '%archived_unfinished_task_count%'",
    );
    expect(batch14Paste).not.toMatch(/\b(?:child_table|child_column|parent_table)\b/);
  });
});

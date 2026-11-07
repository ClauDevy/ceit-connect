import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const boardPage = readFileSync(join(root, "src/app/(dashboard)/events/[eventId]/page.tsx"), "utf8");
const activityPage = readFileSync(join(root, "src/app/(dashboard)/activity-log/page.tsx"), "utf8");
const activityReader = readFileSync(join(root, "supabase/migrations/20261106150000_activity_log_subjects.sql"), "utf8");
const autoArchiveMigration = readFileSync(join(root, "supabase/migrations/20261108120000_event_auto_archive.sql"), "utf8");

describe("Batch D app contracts", () => {
  it("loads a fresh warning only after selecting an Active event", () => {
    expect(boardPage).toContain('export const dynamic = "force-dynamic"');
    expect(boardPage.indexOf('.eq("status", "Active")')).toBeLessThan(
      boardPage.indexOf("<BoardData"),
    );
    expect(boardPage).toContain('supabase.rpc("get_event_auto_archive_warning"');
    expect(boardPage).not.toContain("warningResult.error.message");
  });

  it("keeps the global log active-leadership-only and renders the system archive row", () => {
    expect(activityPage).toContain('getActiveProfileForRoles(["Admin", "Co-Admin"])');
    expect(activityPage).toContain('if (!profile)');
    expect(activityPage).toContain('redirect("/home")');
    expect(activityReader).toContain("when v_candidate.actor_kind = 'system' then 'System'");
    expect(autoArchiveMigration).toContain("'Event archived automatically'");
  });
});

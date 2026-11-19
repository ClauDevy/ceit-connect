import { describe, expect, it } from "vitest";
import {
  activityExportRpcArgs,
  activityRowsToCsv,
  escapeActivityCsvCell,
  exportLimitExceeded,
  normalizeActivityLogRetentionSetting,
} from "@/lib/activity-log-admin";
import type { ActivityRow } from "@/lib/activity-log";

const row: ActivityRow = {
  activityId: "01890f3e-7b2c-7cc1-9234-0123456789ab",
  activityCreatedAt: "2026-11-19T08:00:00+08:00",
  action: "UPDATE",
  taskId: null,
  taskTitle: "Confidential Task",
  eventName: null,
  committeeId: null,
  committeeName: null,
  actorName: null,
  changeSummary: null,
  isMasked: true,
};

describe("Activity Log administration helpers", () => {
  it("exports the current filters, sort, and exact cursor in 500-row pages", () => {
    expect(activityExportRpcArgs({
      sort: "oldest",
      action: "DELETE",
      committeeId: "01890f3e-7b2c-7cc1-9234-0123456789ab",
      dateFrom: "2026-11-01",
      dateTo: "2026-11-19",
      search: "  needle  ",
    }, {
      createdAt: "2026-11-19T08:00:00.123456+08:00",
      id: "01890f3e-7b2c-7cc1-9234-0123456789ab",
    })).toEqual({
      p_sort: "oldest",
      p_action: "DELETE",
      p_committee_id: "01890f3e-7b2c-7cc1-9234-0123456789ab",
      p_date_from: "2026-11-01",
      p_date_to: "2026-11-19",
      p_search: "needle",
      p_cursor_created_at: "2026-11-19T08:00:00.123456+08:00",
      p_cursor_id: "01890f3e-7b2c-7cc1-9234-0123456789ab",
      p_page_size: 500,
    });
  });

  it("normalizes only the exact saved setting shape", () => {
    expect(normalizeActivityLogRetentionSetting([{
      retention_days: 30,
      updated_at: "2026-11-19T08:00:00+08:00",
      updated_by: null,
    }])).toEqual({
      retentionDays: 30,
      updatedAt: "2026-11-19T08:00:00+08:00",
      updatedBy: null,
    });
    expect(normalizeActivityLogRetentionSetting([{ retention_days: "30" }]))
      .toBeNull();
  });

  it.each(["=SUM(A1:A2)", "+cmd", "-1+2", "@name", "\tformula", "\rformula"])(
    "neutralizes the dangerous CSV prefix in %j",
    (value) => {
      expect(escapeActivityCsvCell(value)).toBe(`"'${value}"`);
    },
  );

  it("quotes commas, quotes, and newlines and adds a UTF-8 BOM", () => {
    expect(escapeActivityCsvCell('A, "quoted"\nvalue')).toBe(
      '"A, ""quoted""\nvalue"',
    );
    const csv = activityRowsToCsv([{ ...row, taskTitle: "=secret" }]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"\'=secret"');
    expect(csv).toContain("\r\n");
    expect(csv).not.toContain("activity_id");
  });

  it("rejects a partial CSV whenever the 5,000-row cap is exceeded", () => {
    expect(exportLimitExceeded(4_999, true)).toBe(false);
    expect(exportLimitExceeded(5_000, true)).toBe(true);
    expect(exportLimitExceeded(5_001, false)).toBe(true);
  });
});

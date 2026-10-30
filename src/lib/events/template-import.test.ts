import { describe, expect, it } from "vitest";
import {
  isTemplateTaskEditable,
  normalizeTemplateExclusionIds,
  parseArchivedTemplateTasks,
  removeTemplateDerivedTasks,
  shouldUseCoAdminTemplateCreate,
} from "./template-import";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const COMMITTEE_ID = "22222222-2222-4222-8222-222222222222";

function task(overrides: Record<string, unknown> = {}) {
  return {
    source_task_id: SOURCE_ID,
    title: "Overnight ingress",
    description: null,
    phase: "Live",
    committee_id: COMMITTEE_ID,
    task_type: "LiveOperation",
    priority: "High",
    due_date: null,
    call_time: "2026-11-01T15:00:00.000Z",
    end_time: "2026-11-01T18:00:00.000Z",
    status: "To Do",
    assignee_ids: [],
    ...overrides,
  };
}

describe("Archived template task parsing", () => {
  it("preserves a Live Operation end date that differs in Manila", () => {
    expect(parseArchivedTemplateTasks([task()])).toEqual([
      expect.objectContaining({
        sourceTaskId: SOURCE_ID,
        callDate: "2026-11-01",
        callTime: "23:00",
        endDate: "2026-11-02",
        endTime: "02:00",
      }),
    ]);
  });

  it("preserves null schedules as empty form values", () => {
    expect(
      parseArchivedTemplateTasks([
        task({ task_type: "Deliverable", call_time: null, end_time: null }),
      ]),
    ).toEqual([
      expect.objectContaining({
        dueDate: "",
        callDate: "",
        callTime: "",
        endDate: "",
        endTime: "",
      }),
    ]);
  });

  it("round-trips date-only and cross-day timestamp due dates to one Manila day", () => {
    const parsed = parseArchivedTemplateTasks([
      task({ due_date: "2026-11-02" }),
      task({
        source_task_id: "33333333-3333-4333-8333-333333333333",
        due_date: "2026-11-01T16:30:00.000Z",
      }),
    ]);

    expect(parsed?.map(({ dueDate }) => dueDate)).toEqual([
      "2026-11-02",
      "2026-11-02",
    ]);
  });

  it("fails closed on malformed source ids, committee ids, or schedules", () => {
    expect(parseArchivedTemplateTasks([task({ source_task_id: "bad" })])).toBeNull();
    expect(parseArchivedTemplateTasks([task({ committee_id: "bad" })])).toBeNull();
    expect(
      parseArchivedTemplateTasks([task({ call_time: null })]),
    ).toBeNull();
    expect(
      parseArchivedTemplateTasks([task({ due_date: "not-a-date" })]),
    ).toBeNull();
    expect(
      parseArchivedTemplateTasks([task({ end_time: "not-a-date" })]),
    ).toBeNull();
  });
});

describe("Archived template authority helpers", () => {
  it("makes every Admin row editable and only same-committee Co-Admin rows editable", () => {
    expect(
      isTemplateTaskEditable({
        role: "Admin",
        callerCommitteeId: null,
        taskCommitteeId: COMMITTEE_ID,
      }),
    ).toBe(true);
    expect(
      isTemplateTaskEditable({
        role: "Co-Admin",
        callerCommitteeId: COMMITTEE_ID.toUpperCase(),
        taskCommitteeId: COMMITTEE_ID,
      }),
    ).toBe(true);
    expect(
      isTemplateTaskEditable({
        role: "Co-Admin",
        callerCommitteeId: "33333333-3333-4333-8333-333333333333",
        taskCommitteeId: COMMITTEE_ID,
      }),
    ).toBe(false);
  });

  it("canonicalizes, deduplicates, and caps opaque exclusions", () => {
    expect(
      normalizeTemplateExclusionIds([SOURCE_ID.toUpperCase(), SOURCE_ID]),
    ).toEqual([SOURCE_ID]);
    expect(normalizeTemplateExclusionIds(["bad"])).toBeNull();
    expect(
      normalizeTemplateExclusionIds(Array.from({ length: 201 }, () => SOURCE_ID)),
    ).toBeNull();
  });

  it("removes stale template rows while preserving non-template task setup", () => {
    expect(
      removeTemplateDerivedTasks([
        {
          id: "phase-1",
          tasks: [
            { id: "template", sourceTemplateTaskId: SOURCE_ID },
            { id: "manual", sourceTemplateTaskId: null },
          ],
        },
      ]),
    ).toEqual([
      {
        id: "phase-1",
        tasks: [{ id: "manual", sourceTemplateTaskId: null }],
      },
    ]);
  });

  it("keeps an applied Co-Admin template authoritative after switching tabs", () => {
    expect(
      shouldUseCoAdminTemplateCreate({
        hasInitialEvent: false,
        role: "Co-Admin",
        hasTemplateSummary: true,
      }),
    ).toBe(true);
    expect(
      shouldUseCoAdminTemplateCreate({
        hasInitialEvent: false,
        role: "Admin",
        hasTemplateSummary: true,
      }),
    ).toBe(false);
  });
});

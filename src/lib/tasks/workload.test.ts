import { describe, expect, it } from "vitest";
import {
  formatWorkloadLabel,
  isTaskAssigneeWorkload,
  toEventAssigneeOption,
  workloadCountsByUserId,
} from "./workload";

const row = {
  out_id: "person-1",
  out_full_name: "Maria",
  out_committee_id: null,
  out_avatar_url: null,
  out_active_task_count: 4,
};

describe("task workload helpers", () => {
  it("validates the exact prefixed workload shape", () => {
    expect(isTaskAssigneeWorkload(row)).toBe(true);
    const withoutCount: Record<string, unknown> = { ...row };
    delete withoutCount.out_active_task_count;
    expect(
      isTaskAssigneeWorkload({ ...withoutCount, active_task_count: 4 }),
    ).toBe(false);
    expect(isTaskAssigneeWorkload({ ...row, out_active_task_count: -1 })).toBe(
      false,
    );
  });

  it("joins workload by user id", () => {
    const counts = workloadCountsByUserId([
      row,
      { ...row, out_id: "person-2", out_active_task_count: 0 },
    ]);
    expect(counts.get("person-1")).toBe(4);
    expect(counts.get("person-2")).toBe(0);
    expect(counts.get("missing")).toBeUndefined();
  });

  it("formats singular and plural display-only labels", () => {
    expect(formatWorkloadLabel("Maria", 1)).toBe("Maria - 1 active task");
    expect(formatWorkloadLabel("Maria", 4)).toBe("Maria - 4 active tasks");
  });

  it("maps prefixed rows without adding form payload fields", () => {
    expect(toEventAssigneeOption(row)).toEqual({
      id: "person-1",
      full_name: "Maria",
      committee_id: null,
      avatar_url: null,
      activeTaskCount: 4,
    });
  });
});

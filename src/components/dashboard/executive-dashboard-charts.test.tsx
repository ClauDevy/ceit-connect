import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/shared/motion", () => ({
  ChartBarGrow: ({ axis, observeParent, ...props }: ComponentProps<"div"> & {
    axis?: string;
    observeParent?: boolean;
  }) => {
    void axis;
    return <div data-observe-parent={observeParent ? "true" : "false"} {...props} />;
  },
  useVisibilityAnimation: () => () => undefined,
}));

import { CommitteeWorkload, MemberWorkload, TaskStatusDonut } from "./executive-dashboard-charts";

describe("Executive Dashboard chart accessibility", () => {
  it("renders committee bars as keyboard buttons with text alternatives and 44px targets", () => {
    const markup = renderToStaticMarkup(
      <CommitteeWorkload
        totals={{ status: "ready", data: [{
          committeeId: "c", committeeName: "COEXA", uniqueActiveTaskCount: 4,
          coveredTaskCount: 4, unassignedTaskCount: 0, inactiveOnlyTaskCount: 0,
          activeOutsideCommitteeOnlyTaskCount: 0, tasksWithoutMemberBarCount: 0,
        }] }}
        animate
        onSelect={() => undefined}
      />,
    );
    expect(markup).toContain("<button");
    expect(markup).toContain("min-h-11");
    expect(markup).toContain("Open COEXA dashboard, 4 open tasks");
    expect(markup).toContain("COEXA: 4 open tasks");
    expect(markup).toContain("COEXA committee");
    expect(markup).toContain("break-words");
    expect(markup).toContain("overflow-wrap:anywhere");
    expect(markup).toContain('data-observe-parent="true"');
    expect(markup).not.toContain("truncate");
  });

  it("labels the centre as done and uses a safe no-tasks state", () => {
    const base = {
      openTaskCount: 0, overdueTaskCount: 0, dueIn24HoursTaskCount: 0,
      unassignedTaskCount: 0, helpWantedTaskCount: 0, needsApprovalCount: 0,
      donutOverdueCount: 0, donutDueIn24HoursCount: 0, donutInProgressCount: 0,
      donutToDoCount: 0, donutCompletedCount: 0,
    };
    const empty = renderToStaticMarkup(<TaskStatusDonut overview={base} animate />);
    const populated = renderToStaticMarkup(
      <TaskStatusDonut overview={{ ...base, donutToDoCount: 3, donutCompletedCount: 1 }} animate />,
    );
    expect(empty).toContain("No tasks");
    expect(empty).not.toContain("Infinity");
    expect(empty).not.toContain("NaN");
    expect(populated).toContain("25%");
    expect(populated).toContain("done");
    expect(populated).toContain("To do: 3");
    expect(populated).toContain("Completed: 1");
  });

  it("keeps member bars visible when the slipping-signal reader fails", () => {
    const markup = renderToStaticMarkup(
      <MemberWorkload
        summary={{ status: "ready", data: {
          committeeId: "c", committeeName: "COEXA", uniqueActiveTaskCount: 1,
          coveredTaskCount: 1, unassignedTaskCount: 0, inactiveOnlyTaskCount: 0,
          activeOutsideCommitteeOnlyTaskCount: 0, tasksWithoutMemberBarCount: 0,
        } }}
        members={{ status: "ready", data: [{
          committeeId: "c", memberId: "m", fullName: "Visible Member",
          avatarUrl: null, activeTaskCount: 1,
        }] }}
        signals={{ status: "error" }}
        animate
      />,
    );
    expect(markup).toContain("Visible Member");
    expect(markup).toContain("break-words");
    expect(markup).toContain("overflow-wrap:anywhere");
    expect(markup).not.toContain("truncate");
    expect(markup).toContain("Workload signals are unavailable");
    expect(markup).not.toContain("0 open");
  });
});

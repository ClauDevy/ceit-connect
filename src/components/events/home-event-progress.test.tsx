import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HomeEventProgressSummary } from "./home-event-progress";

describe("HomeEventProgressSummary", () => {
  it("renders one compact accessible summary", () => {
    const markup = renderToStaticMarkup(
      <HomeEventProgressSummary
        eventName="Foundation Day"
        progress={{
          phaseLabel: "Setup",
          percentage: 67,
          visibleBackupRequestCount: 2,
          backlogCount: 3,
        }}
      />,
    );
    expect(markup).toContain("Phase:");
    expect(markup).toContain("Setup");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="67"');
    expect(markup).toContain("67%");
    expect(markup).toContain("Backup requests you can see: 2");
    expect(markup).toContain("Backlog: 3");
  });

  it("supports all-complete and zero-task phase labels", () => {
    const complete = renderToStaticMarkup(
      <HomeEventProgressSummary
        eventName="Complete"
        progress={{
          phaseLabel: "All phases complete",
          percentage: 100,
          visibleBackupRequestCount: 0,
          backlogCount: 0,
        }}
      />,
    );
    const noPhase = renderToStaticMarkup(
      <HomeEventProgressSummary
        eventName="No phase"
        progress={{
          phaseLabel: null,
          percentage: 0,
          visibleBackupRequestCount: 0,
          backlogCount: 0,
        }}
      />,
    );
    expect(complete).toContain("All phases complete");
    expect(noPhase).not.toContain("Phase:");
  });

  it("shows a safe fallback without raw reader details", () => {
    const markup = renderToStaticMarkup(
      <HomeEventProgressSummary eventName="Unavailable" progress={null} />,
    );
    expect(markup).toContain("Progress unavailable");
    expect(markup).not.toContain("Supabase");
  });
});

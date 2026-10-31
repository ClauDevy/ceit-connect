import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ListPager } from "./list-pager";

const slots = [
  { key: "page-1", page: 1 },
  { key: "page-2", page: 2 },
  { key: "slot-2", page: null },
];

function renderPager(overrides: Partial<React.ComponentProps<typeof ListPager>> = {}) {
  return renderToStaticMarkup(
    <ListPager
      activePage={1}
      ariaLabel="Task history pages"
      nextDisabled={false}
      onNext={vi.fn()}
      onPage={vi.fn()}
      onPrevious={vi.fn()}
      pageSize={10}
      previousDisabled
      slots={slots}
      {...overrides}
    />,
  );
}

describe("shared list pager", () => {
  it("preserves the Task History labels, slots, active state, and disabled arrows", () => {
    const html = renderPager();
    expect(html).toContain("Showing 10 per page");
    expect(html).toContain('aria-label="Task history pages"');
    expect(html).toContain('aria-label="Previous page block"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Page 2"');
    expect(html).toContain('aria-label="Next page block"');
  });

  it("preserves Activity Log sticky positioning and its busy next-page indicator", () => {
    const html = renderPager({
      ariaLabel: "Activity log pages",
      className:
        "sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] md:bottom-0",
      nextBusy: true,
      nextTitle: "Preparing next page block",
      pageSize: 20,
      previousTitle: "Previous page block",
    });
    expect(html).toContain("Showing 20 per page");
    expect(html).toContain('aria-label="Activity log pages"');
    expect(html).toContain("bottom-[calc(4.25rem+env(safe-area-inset-bottom))]");
    expect(html).toContain('aria-label="Preparing next page block"');
    expect(html).toContain("animate-spin motion-reduce:animate-none");
  });

  it("keeps Task History and Activity Log as mechanical shared-pager consumers", () => {
    const task = readFileSync("src/components/tasks/task-history.tsx", "utf8");
    const activity = readFileSync(
      "src/components/activity-log/activity-log-page.tsx",
      "utf8",
    );
    expect(task).toContain("<ListPager");
    expect(task).toContain('ariaLabel="Task history pages"');
    expect(task).toContain("slots={pagerSlots}");
    expect(task).toContain("nextDisabled={!page?.hasMore || nextCursor === undefined}");
    expect(task).not.toContain("<nav");
    expect(activity).toContain("<ListPager");
    expect(activity).toContain('ariaLabel="Activity log pages"');
    expect(activity).toContain("slots={pagerSlots}");
    expect(activity).toContain("nextBusy={nextArrowBusy}");
    expect(activity).toContain("navigationDisabled={navigating}");
    expect(activity).not.toContain("<nav");
  });
});

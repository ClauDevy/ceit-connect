import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./event-management.tsx", import.meta.url), "utf8");

describe("Event Management UI contract", () => {
  it("uses the shared stable-ID motion kit with a reduced-motion-safe state", () => {
    expect(source).toContain("useListReveal");
    expect(source).toContain("event-management-desktop-${event.id}");
    expect(source).toContain("event-management-mobile-${event.id}");
    expect(source).toContain("motion-reduce:animate-none");
  });

  it("keeps typed confirmation, double-submit prevention, and authoritative refetch", () => {
    expect(source).toContain('id="event-deletion-confirmation"');
    expect(source).toContain("confirmation !== requiredConfirmation");
    expect(source).toContain("deleteBusy ||");
    expect(source).toContain("finally");
    expect(source).toContain("router.refresh()");
    expect(source).toContain("snapshotEventDeletionSelection(selection)");
    expect(source).toContain("expectedUpdatedAt: event.updated_at");
  });

  it("uses only the two approved POST route actions", () => {
    expect(source).toContain('{ action: "status" }');
    expect(source).toContain('action: "retry"');
    expect(source).not.toContain("method: \"GET\"");
  });

  it("uses shared ten-row paging and resets selection with the year filter", () => {
    expect(source).toContain("<ListPager");
    expect(source).toContain('ariaLabel="Event management pages"');
    expect(source).toContain("EVENT_MANAGEMENT_PAGE_SIZE");
    expect(source).toContain("resetEventManagementFilter(nextYear)");
    expect(source).toContain("items={yearLabels}");
  });

  it("keeps the desktop table vertically unbounded only at the fitting breakpoint", () => {
    expect(source).toContain(
      'lg:[&_[data-slot=table-container]]:overflow-visible',
    );
    expect(source).not.toContain(
      'md:[&_[data-slot=table-container]]:overflow-visible',
    );
    expect(source).toContain('className="block min-w-0 cursor-pointer truncate"');
  });

  it("provides page checkboxes, row-click safeguards, and non-covering mobile actions", () => {
    expect(source).toContain('aria-label="Select this page"');
    expect(source).toContain("node.indeterminate = pageSelection.indeterminate");
    expect(source).toContain("shouldToggleEventRowSelection");
    expect(source).toContain('selection.size > 0 && "pb-24 md:pb-0"');
    expect(source).toContain(
      "bottom-[calc(4.25rem+env(safe-area-inset-bottom))]",
    );
    expect(source).not.toContain("Clear visible selection");
    expect(source).not.toContain("Delete selected (");
  });

  it("renders both event statuses as readable neutral badges", () => {
    expect(source).toContain('return <Badge variant="neutral">{status}</Badge>');
    expect(source).toContain("<EventStatusBadge status={event.status} />");
  });
});

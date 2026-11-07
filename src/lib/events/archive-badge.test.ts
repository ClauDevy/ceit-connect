import { describe, expect, it } from "vitest";
import { archivedUnfinishedTaskLabel } from "./list-paging";

describe("archive unfinished-task badge", () => {
  it("uses a visible singular or plural label and hides zero and null", () => {
    expect(archivedUnfinishedTaskLabel(1)).toBe("1 unfinished task");
    expect(archivedUnfinishedTaskLabel(4)).toBe("4 unfinished tasks");
    expect(archivedUnfinishedTaskLabel(0)).toBeNull();
    expect(archivedUnfinishedTaskLabel(null)).toBeNull();
  });
});

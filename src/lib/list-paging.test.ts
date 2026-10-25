import { describe, expect, it } from "vitest";
import {
  LIST_FETCH_LIMIT,
  LIST_PAGE_SIZE,
  appendUniqueById,
  applyOffsetListPage,
  createOffsetListData,
  formatLoadMoreAnnouncement,
  normalizeLookaheadPage,
  prepareOffsetListRequest,
  shouldPollOffsetList,
  type OffsetListData,
} from "./list-paging";

type Row = { id: string; value: string };

function rows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `row-${String(index + 1).padStart(2, "0")}`,
    value: `Row ${index + 1}`,
  }));
}

function pageAt(allRows: readonly Row[], offset: number) {
  return normalizeLookaheadPage(
    allRows.slice(offset, offset + LIST_FETCH_LIMIT),
    offset,
  );
}

const getId = (row: Row) => row.id;

describe("lookahead page normalization", () => {
  for (const count of [0, 1, 19, 20]) {
    it(`shows all ${count} rows without a false next page`, () => {
      const page = pageAt(rows(count), 0);
      expect(page.items).toHaveLength(count);
      expect(page.hasMore).toBe(false);
    });
  }

  it("fetches 21 but exposes only 20", () => {
    const page = pageAt(rows(21), 0);
    expect(LIST_PAGE_SIZE).toBe(20);
    expect(LIST_FETCH_LIMIT).toBe(21);
    expect(page.items).toHaveLength(20);
    expect(page.hasMore).toBe(true);
    expect(page.items.map(getId)).not.toContain("row-21");
  });

  it("does not show a false Load more at exactly 40 rows", () => {
    const allRows = rows(40);
    const first = pageAt(allRows, 0);
    const second = pageAt(allRows, 20);
    expect(first.hasMore).toBe(true);
    expect(second.items).toHaveLength(20);
    expect(second.hasMore).toBe(false);
  });

  it("uses offsets 0, 20, 40 for 41 rows", () => {
    const allRows = rows(41);
    const pages = [
      pageAt(allRows, 0),
      pageAt(allRows, 20),
      pageAt(allRows, 40),
    ];
    expect(pages.map((page) => page.offset)).toEqual([0, 20, 40]);
    expect(pages.map((page) => page.hasMore)).toEqual([true, true, false]);
    expect(pages.map((page) => page.items.length)).toEqual([20, 20, 1]);
  });

  it("refetches the lookahead as the next page's first candidate", () => {
    const allRows = rows(21);
    const rawFirst = allRows.slice(0, LIST_FETCH_LIMIT);
    const first = normalizeLookaheadPage(rawFirst, 0);
    const second = pageAt(allRows, 20);
    expect(rawFirst[20].id).toBe("row-21");
    expect(first.items.map(getId)).not.toContain("row-21");
    expect(second.items[0].id).toBe("row-21");
  });
});

describe("stable-id accumulation and replacement", () => {
  it("deduplicates overlaps, uses the newer row, and keeps first position", () => {
    const current = [
      { id: "b", value: "old" },
      { id: "c", value: "third" },
    ];
    const incoming = [
      { id: "b", value: "new" },
      { id: "d", value: "fourth" },
    ];
    expect(appendUniqueById(current, incoming, getId)).toEqual({
      items: [
        { id: "b", value: "new" },
        { id: "c", value: "third" },
        { id: "d", value: "fourth" },
      ],
      addedCount: 1,
    });
  });

  it("preserves the server's stable-id tie order", () => {
    const tied = [
      { id: "a", value: "same business sort" },
      { id: "b", value: "same business sort" },
      { id: "c", value: "same business sort" },
    ];
    expect(appendUniqueById([], tied, getId).items.map(getId)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("replaces accumulated rows on identity or authoritative refresh", () => {
    const current: OffsetListData<Row> = {
      items: rows(40),
      hasMore: true,
      nextOffset: 40,
    };
    const replacement = normalizeLookaheadPage(
      [{ id: "replacement", value: "Fresh" }],
      0,
    );
    const result = applyOffsetListPage({
      current,
      page: replacement,
      mode: "replace",
      getId,
      responseToken: 2,
      currentToken: 2,
    });
    expect(result.data.items).toEqual(replacement.items);
    expect(result.data.hasMore).toBe(false);
    expect(result.data.nextOffset).toBe(20);
  });

  for (const interruption of [
    "poll",
    "focus refresh",
    "tab switch",
    "identity change",
  ]) {
    it(`ignores a late Load more response after a ${interruption}`, () => {
      const replaced = createOffsetListData(
        normalizeLookaheadPage([{ id: "fresh", value: "Fresh" }], 0),
        getId,
      );
      const latePageTwo = normalizeLookaheadPage(
        [{ id: "late", value: "Late page two" }],
        20,
      );
      const result = applyOffsetListPage({
        current: replaced,
        page: latePageTwo,
        mode: "append",
        getId,
        responseToken: 1,
        currentToken: 2,
      });
      expect(result.applied).toBe(false);
      expect(result.data).toBe(replaced);
      expect(result.data.items.map(getId)).toEqual(["fresh"]);
    });
  }

  it("keeps visible rows through an error and replaces them on retry success", () => {
    const current: OffsetListData<Row> = {
      items: rows(20),
      hasMore: true,
      nextOffset: 20,
    };
    const duringRefresh = prepareOffsetListRequest(current, "replace");
    expect(duringRefresh.items).toBe(current.items);
    expect(duringRefresh.hasMore).toBe(false);

    const retry = applyOffsetListPage({
      current: duringRefresh,
      page: normalizeLookaheadPage(
        [{ id: "retry", value: "Retry success" }],
        0,
      ),
      mode: "replace",
      getId,
      responseToken: 3,
      currentToken: 3,
    });
    expect(retry.data.items.map(getId)).toEqual(["retry"]);
  });
});

describe("polling and accessible announcements", () => {
  it("polls only an active, visible, unpaused list", () => {
    expect(
      shouldPollOffsetList({ active: true, visible: true, busy: false }),
    ).toBe(true);
    expect(
      shouldPollOffsetList({ active: false, visible: true, busy: false }),
    ).toBe(false);
    expect(
      shouldPollOffsetList({ active: true, visible: false, busy: false }),
    ).toBe(false);
    expect(
      shouldPollOffsetList({ active: true, visible: true, busy: true }),
    ).toBe(false);
  });

  it("announces only visible additions, never the lookahead", () => {
    const page = pageAt(rows(21), 0);
    expect(
      formatLoadMoreAnnouncement(
        page.items.length,
        page.items.length,
        "task",
        "tasks",
      ),
    ).toBe("20 more tasks loaded, 20 tasks loaded.");
    expect(page.items).toHaveLength(20);
  });
});

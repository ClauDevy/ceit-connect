export const LIST_PAGE_SIZE = 20;
export const LIST_FETCH_LIMIT = LIST_PAGE_SIZE + 1;

export type OffsetListPage<T> = {
  items: T[];
  hasMore: boolean;
  offset: number;
};

export type OffsetListData<T> = {
  items: T[];
  hasMore: boolean;
  nextOffset: number;
};

export function normalizeLookaheadPage<T>(
  rows: readonly T[],
  offset: number,
): OffsetListPage<T> {
  return {
    items: rows.slice(0, LIST_PAGE_SIZE),
    hasMore: rows.length > LIST_PAGE_SIZE,
    offset,
  };
}

export function appendUniqueById<T>(
  current: readonly T[],
  incoming: readonly T[],
  getId: (item: T) => string,
) {
  const byId = new Map<string, T>();
  for (const item of current) byId.set(getId(item), item);

  let addedCount = 0;
  for (const item of incoming) {
    const id = getId(item);
    if (!byId.has(id)) addedCount += 1;
    byId.set(id, item);
  }

  return { items: [...byId.values()], addedCount };
}

export function replaceUniqueById<T>(
  incoming: readonly T[],
  getId: (item: T) => string,
) {
  return appendUniqueById([], incoming, getId).items;
}

export function getNextOffset<T>(page: OffsetListPage<T>) {
  return page.offset + LIST_PAGE_SIZE;
}

export function createOffsetListData<T>(
  page: OffsetListPage<T>,
  getId: (item: T) => string,
): OffsetListData<T> {
  return {
    items: replaceUniqueById(page.items, getId),
    hasMore: page.hasMore,
    nextOffset: getNextOffset(page),
  };
}

export function prepareOffsetListRequest<T>(
  current: OffsetListData<T>,
  mode: "append" | "replace",
): OffsetListData<T> {
  return {
    ...current,
    hasMore: mode === "replace" ? false : current.hasMore,
  };
}

export function applyOffsetListPage<T>({
  current,
  page,
  mode,
  getId,
  responseToken,
  currentToken,
}: {
  current: OffsetListData<T>;
  page: OffsetListPage<T>;
  mode: "append" | "replace";
  getId: (item: T) => string;
  responseToken: number;
  currentToken: number;
}) {
  if (responseToken !== currentToken) {
    return { data: current, addedCount: 0, applied: false };
  }

  if (mode === "replace") {
    const items = replaceUniqueById(page.items, getId);
    return {
      data: {
        items,
        hasMore: page.hasMore,
        nextOffset: getNextOffset(page),
      },
      addedCount: items.length,
      applied: true,
    };
  }

  const appended = appendUniqueById(current.items, page.items, getId);
  return {
    data: {
      items: appended.items,
      hasMore: page.hasMore,
      nextOffset: getNextOffset(page),
    },
    addedCount: appended.addedCount,
    applied: true,
  };
}

export function shouldPollOffsetList({
  active,
  visible,
  busy,
}: {
  active: boolean;
  visible: boolean;
  busy: boolean;
}) {
  return active && visible && !busy;
}

export function formatLoadMoreAnnouncement(
  addedCount: number,
  totalCount: number,
  singular: string,
  plural: string,
) {
  const addedLabel = addedCount === 1 ? singular : plural;
  const totalLabel = totalCount === 1 ? singular : plural;
  return `${addedCount} more ${addedLabel} loaded, ${totalCount} ${totalLabel} loaded.`;
}

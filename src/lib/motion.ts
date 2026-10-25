export const ENTRANCE_DURATION_MS = 300;
export const ENTRANCE_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
export const ENTRANCE_ITEM_LIMIT = 20;
export const ENTRANCE_STAGGER_ITEM_LIMIT = 8;
export const ENTRANCE_STAGGER_MS = 40;
export const INTERACTION_DURATION_MS = 220;
export const PROGRESS_DURATION_MS = 700;
export const PANEL_DURATION_MS = 260;
export const EXIT_DURATION_MS = 220;
export const SUCCESS_DURATION_MS = 400;
export const PROGRESS_VISIBILITY_THRESHOLD = 0.4;
export const LIST_ENTRANCE_ANIMATION_NAME = "cc-list-item-enter";
export const LIST_REVEAL_ANIMATION_NAME = "cc-list-item-reveal";
export const SUCCESS_ANIMATION_NAME = "cc-success-enter";

export function decodeHashId(hash: string) {
  const encodedId = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!encodedId) return null;

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

export function getEntranceDelayMs(index: number) {
  return Math.min(Math.max(index, 0), ENTRANCE_STAGGER_ITEM_LIMIT - 1) * ENTRANCE_STAGGER_MS;
}

export function getEntranceClassName(capture: EntranceCapture, id: string) {
  if (capture.phase !== "playing" || !capture.ids.has(id)) return undefined;
  const index = [...capture.ids].indexOf(id);
  return `motion-list-item-enter motion-list-delay-${Math.min(index, ENTRANCE_STAGGER_ITEM_LIMIT - 1)}`;
}

export function capturedPrefixIsStable<T>(
  capture: EntranceCapture,
  items: readonly T[],
  getId: (item: T) => string,
) {
  const capturedIds = [...capture.ids];
  return capturedIds.every((id, index) => items[index] !== undefined && getId(items[index]) === id);
}

export type EntranceCapture = {
  phase: "waiting" | "playing" | "done";
  ids: ReadonlySet<string>;
  initialIds: ReadonlySet<string>;
};

export type RevealRegistry = {
  revealedIds: Set<string>;
};

export function createRevealRegistry(
  revealedIds: Iterable<string> = [],
): RevealRegistry {
  return { revealedIds: new Set(revealedIds) };
}

export function claimReveal(registry: RevealRegistry, id: string) {
  if (registry.revealedIds.has(id)) return false;
  registry.revealedIds.add(id);
  return true;
}

export function selectEntranceIds<T>(
  items: readonly T[],
  getId: (item: T) => string,
) {
  return new Set(items.slice(0, ENTRANCE_ITEM_LIMIT).map(getId));
}

/**
 * Creates the immutable initial eligibility set for a list mount.
 *
 * Server-backed lists pass their rendered first page to `initialItems`. Lists
 * without server data wait for the first settled, successful, non-placeholder
 * render. An initial error permanently resolves to an empty set, so retry,
 * polling, filters, replacement data, and later pages can never arm motion.
 */
export function createEntranceCapture<T>({
  initialItems,
  getId,
  waitForSuccessfulData,
}: {
  initialItems?: readonly T[];
  getId: (item: T) => string;
  waitForSuccessfulData: boolean;
}): EntranceCapture {
  if (initialItems !== undefined) {
    const ids = selectEntranceIds(initialItems, getId);
    return {
      phase: ids.size > 0 ? "playing" : "done",
      ids,
      initialIds: new Set(initialItems.map(getId)),
    };
  }

  return {
    phase: waitForSuccessfulData ? "waiting" : "done",
    ids: new Set<string>(),
    initialIds: new Set<string>(),
  };
}

export function settleEntranceCapture<T>({
  capture,
  items,
  settled,
  error,
  isPlaceholderData,
  getId,
}: {
  capture: EntranceCapture;
  items: readonly T[];
  settled: boolean;
  error: unknown;
  isPlaceholderData: boolean;
  getId: (item: T) => string;
}): EntranceCapture {
  if (capture.phase !== "waiting" || !settled) return capture;

  if (error !== null && error !== undefined) {
    return {
      phase: "done",
      ids: new Set<string>(),
      initialIds: new Set<string>(),
    };
  }

  if (isPlaceholderData) return capture;

  const ids = selectEntranceIds(items, getId);
  return {
    phase: ids.size > 0 ? "playing" : "done",
    ids,
    initialIds: new Set(items.map(getId)),
  };
}

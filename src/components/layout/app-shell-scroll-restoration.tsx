"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";

const SCROLL_STORAGE_KEY = "ceit-connect:app-shell-scroll:v1";
const MAX_SAVED_POSITIONS = 50;
const RESTORE_RETRY_MS = 50;
const RESTORE_TIMEOUT_MS = 2_000;
const USER_SCROLL_SESSION_MS = 200;

type SavedPosition = {
  key: string;
  top: number;
};

type SavedPositions = {
  version: 1;
  entries: SavedPosition[];
};

function readSavedPositions(): SavedPosition[] {
  try {
    const raw = window.sessionStorage.getItem(SCROLL_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Partial<SavedPositions>;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return [];

    return parsed.entries.filter(
      (entry): entry is SavedPosition =>
        Boolean(entry) &&
        typeof entry.key === "string" &&
        typeof entry.top === "number" &&
        Number.isFinite(entry.top) &&
        entry.top >= 0,
    );
  } catch {
    return [];
  }
}

function readSavedPosition(key: string): number | null {
  return readSavedPositions().find((entry) => entry.key === key)?.top ?? null;
}

function savePosition(key: string, top: number) {
  if (!Number.isFinite(top) || top < 0) return;

  try {
    const entries = readSavedPositions().filter((entry) => entry.key !== key);
    entries.push({ key, top });
    window.sessionStorage.setItem(
      SCROLL_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: entries.slice(-MAX_SAVED_POSITIONS),
      } satisfies SavedPositions),
    );
  } catch {
    // Scroll restoration is an enhancement; unavailable storage is harmless.
  }
}

function deleteSavedPosition(key: string) {
  try {
    const entries = readSavedPositions();
    const nextEntries = entries.filter((entry) => entry.key !== key);
    if (nextEntries.length === entries.length) return;

    window.sessionStorage.setItem(
      SCROLL_STORAGE_KEY,
      JSON.stringify({ version: 1, entries: nextEntries } satisfies SavedPositions),
    );
  } catch {
    // Scroll restoration is an enhancement; unavailable storage is harmless.
  }
}

function locationKey() {
  const search = new URLSearchParams(window.location.search).toString();
  return `${window.location.pathname}${search ? `?${search}` : ""}`;
}

function isScrollKey(event: KeyboardEvent) {
  return [
    "ArrowDown",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
    " ",
  ].includes(event.key);
}

function AppShellScrollRestoration({
  scrollRef,
  routeKey,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  routeKey: string;
}) {
  const currentRouteKeyRef = React.useRef(routeKey);
  const pendingPopRouteKeyRef = React.useRef<string | null>(null);
  const restoreTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollSaveFrameRef = React.useRef<number | null>(null);
  const scrollSessionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const userScrollSessionRef = React.useRef(false);
  const ownRestoreTargetRef = React.useRef<number | null>(null);
  const cancelRestoreRef = React.useRef<() => void>(() => undefined);

  const clearRestoreTimer = React.useCallback(() => {
    if (restoreTimerRef.current !== null) {
      clearTimeout(restoreTimerRef.current);
      restoreTimerRef.current = null;
    }
  }, []);

  const endUserScrollSession = React.useCallback(() => {
    userScrollSessionRef.current = false;
    if (scrollSessionTimerRef.current !== null) {
      clearTimeout(scrollSessionTimerRef.current);
      scrollSessionTimerRef.current = null;
    }
  }, []);

  const extendUserScrollSession = React.useCallback(() => {
    userScrollSessionRef.current = true;
    if (scrollSessionTimerRef.current !== null) {
      clearTimeout(scrollSessionTimerRef.current);
    }
    scrollSessionTimerRef.current = setTimeout(() => {
      userScrollSessionRef.current = false;
      scrollSessionTimerRef.current = null;
    }, USER_SCROLL_SESSION_MS);
  }, []);

  React.useEffect(() => {
    function handlePopState() {
      const destinationKey = locationKey();
      if (destinationKey === currentRouteKeyRef.current) return;
      pendingPopRouteKeyRef.current = destinationKey;
    }

    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, []);

  React.useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return;
    const element = scrollElement;

    function handleUserScrollIntent() {
      cancelRestoreRef.current();
      extendUserScrollSession();
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isScrollKey(event)) handleUserScrollIntent();
    }

    function handleClick() {
      endUserScrollSession();
    }

    function handleScroll() {
      const ownTarget = ownRestoreTargetRef.current;
      if (ownTarget !== null && Math.abs(element.scrollTop - ownTarget) <= 1) {
        ownRestoreTargetRef.current = null;
        return;
      }

      if (!userScrollSessionRef.current) return;
      cancelRestoreRef.current();
      extendUserScrollSession();

      const shownPageKey = currentRouteKeyRef.current;
      const shownPageTop = element.scrollTop;
      if (scrollSaveFrameRef.current !== null) {
        cancelAnimationFrame(scrollSaveFrameRef.current);
      }
      scrollSaveFrameRef.current = requestAnimationFrame(() => {
        scrollSaveFrameRef.current = null;
        if (currentRouteKeyRef.current !== shownPageKey) return;
        savePosition(shownPageKey, shownPageTop);
      });
    }

    scrollElement.addEventListener("wheel", handleUserScrollIntent, { passive: true });
    scrollElement.addEventListener("touchstart", handleUserScrollIntent, { passive: true });
    scrollElement.addEventListener("touchmove", handleUserScrollIntent, { passive: true });
    scrollElement.addEventListener("pointerdown", handleUserScrollIntent, { passive: true });
    scrollElement.addEventListener("keydown", handleKeyDown);
    scrollElement.addEventListener("click", handleClick, true);
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      scrollElement.removeEventListener("wheel", handleUserScrollIntent);
      scrollElement.removeEventListener("touchstart", handleUserScrollIntent);
      scrollElement.removeEventListener("touchmove", handleUserScrollIntent);
      scrollElement.removeEventListener("pointerdown", handleUserScrollIntent);
      scrollElement.removeEventListener("keydown", handleKeyDown);
      scrollElement.removeEventListener("click", handleClick, true);
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [endUserScrollSession, extendUserScrollSession, scrollRef]);

  React.useEffect(() => {
    const scrollElement = scrollRef.current;
    currentRouteKeyRef.current = routeKey;
    clearRestoreTimer();
    ownRestoreTargetRef.current = null;

    let cancelled = false;
    cancelRestoreRef.current = () => {
      cancelled = true;
      clearRestoreTimer();
    };

    if (!scrollElement || pendingPopRouteKeyRef.current !== routeKey) {
      if (pendingPopRouteKeyRef.current !== routeKey) {
        pendingPopRouteKeyRef.current = null;
        deleteSavedPosition(routeKey);
      }
      return () => {
        cancelled = true;
        clearRestoreTimer();
      };
    }

    pendingPopRouteKeyRef.current = null;
    const savedTop = readSavedPosition(routeKey);
    if (savedTop === null) {
      return () => {
        cancelled = true;
        clearRestoreTimer();
      };
    }

    const deadline = Date.now() + RESTORE_TIMEOUT_MS;
    const attemptRestore = () => {
      if (cancelled) return;

      const maximumTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      if (maximumTop >= savedTop) {
        ownRestoreTargetRef.current = savedTop;
        scrollElement.scrollTop = savedTop;
        return;
      }

      if (Date.now() >= deadline) return;
      restoreTimerRef.current = setTimeout(attemptRestore, RESTORE_RETRY_MS);
    };

    attemptRestore();
    return () => {
      cancelled = true;
      clearRestoreTimer();
    };
  }, [clearRestoreTimer, routeKey, scrollRef]);

  React.useEffect(
    () => () => {
      clearRestoreTimer();
      endUserScrollSession();
      if (scrollSaveFrameRef.current !== null) {
        cancelAnimationFrame(scrollSaveFrameRef.current);
        scrollSaveFrameRef.current = null;
      }
      cancelRestoreRef.current = () => undefined;
    },
    [clearRestoreTimer, endUserScrollSession],
  );

  return null;
}

function AppShellScrollRouteBridge({
  scrollRef,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const routeKey = `${pathname}${search ? `?${search}` : ""}`;

  return <AppShellScrollRestoration scrollRef={scrollRef} routeKey={routeKey} />;
}

export function AppShellScrollArea({ children }: { children: React.ReactNode }) {
  const scrollRef = React.useRef<HTMLDivElement>(null);

  return (
    <div
      ref={scrollRef}
      data-app-shell-scroll-area
      className="flex min-h-0 min-w-0 flex-1 scroll-pt-24 flex-col overflow-x-hidden overflow-y-auto overscroll-none"
    >
      {children}
      <React.Suspense fallback={null}>
        <AppShellScrollRouteBridge scrollRef={scrollRef} />
      </React.Suspense>
    </div>
  );
}

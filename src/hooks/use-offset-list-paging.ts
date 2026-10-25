"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyOffsetListPage,
  createOffsetListData,
  formatLoadMoreAnnouncement,
  normalizeLookaheadPage,
  prepareOffsetListRequest,
  shouldPollOffsetList,
  type OffsetListData,
  type OffsetListPage,
} from "@/lib/list-paging";

type RequestMode = "append" | "replace";

type PagingState<T> = OffsetListData<T> & {
  announcement: string;
  error: unknown;
  failedMode: RequestMode | null;
  failedOffset: number;
  hasLoadedMore: boolean;
  pendingMode: RequestMode | null;
  settled: boolean;
};

export function useOffsetListPaging<T>({
  active,
  fetchPage,
  getId,
  identity,
  initialPage,
  paused = false,
  pollIntervalMs,
  singularLabel,
  pluralLabel,
}: {
  active: boolean;
  fetchPage: (offset: number, signal: AbortSignal) => Promise<readonly T[]>;
  getId: (item: T) => string;
  identity: string;
  initialPage?: OffsetListPage<T>;
  paused?: boolean;
  pollIntervalMs?: number;
  singularLabel: string;
  pluralLabel: string;
}) {
  const initialData = initialPage
    ? createOffsetListData(initialPage, getId)
    : { items: [], hasMore: false, nextOffset: 0 };
  const [state, setState] = useState<PagingState<T>>({
    ...initialData,
    announcement: "",
    error: null,
    failedMode: null,
    failedOffset: 0,
    hasLoadedMore: false,
    pendingMode: null,
    settled: initialPage !== undefined,
  });
  const stateRef = useRef(state);
  stateRef.current = state;

  const fetchPageRef = useRef(fetchPage);
  const getIdRef = useRef(getId);
  fetchPageRef.current = fetchPage;
  getIdRef.current = getId;

  const abortRef = useRef<AbortController | null>(null);
  const requestTokenRef = useRef(0);
  const identityRef = useRef(identity);
  const previousActiveRef = useRef(active);
  const activeRef = useRef(active);
  const pausedRef = useRef(paused);
  const mountedRef = useRef(true);
  activeRef.current = active;
  pausedRef.current = paused;

  const invalidateRequest = useCallback(() => {
    requestTokenRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const readPage = useCallback(async (offset: number, signal: AbortSignal) => {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await fetchPageRef.current(offset, signal);
      } catch (error) {
        if (signal.aborted) throw error;
        lastError = error;
      }
    }
    throw lastError;
  }, []);

  const requestPage = useCallback(
    async (mode: RequestMode, offset: number) => {
      invalidateRequest();
      const requestToken = requestTokenRef.current;
      const controller = new AbortController();
      abortRef.current = controller;

      setState((current) => ({
        ...current,
        ...prepareOffsetListRequest(current, mode),
        announcement: "",
        error: null,
        failedMode: null,
        pendingMode: mode,
      }));

      try {
        const rows = await readPage(offset, controller.signal);
        if (!mountedRef.current || controller.signal.aborted) return;

        const page = normalizeLookaheadPage(rows, offset);
        setState((current) => {
          const applied = applyOffsetListPage({
            current,
            page,
            mode,
            getId: getIdRef.current,
            responseToken: requestToken,
            currentToken: requestTokenRef.current,
          });
          if (!applied.applied) return current;

          return {
            ...current,
            ...applied.data,
            announcement:
              mode === "append"
                ? formatLoadMoreAnnouncement(
                    applied.addedCount,
                    applied.data.items.length,
                    singularLabel,
                    pluralLabel,
                  )
                : "",
            error: null,
            failedMode: null,
            hasLoadedMore: mode === "append" ? true : false,
            pendingMode: null,
            settled: true,
          };
        });
      } catch (error) {
        if (
          !mountedRef.current ||
          controller.signal.aborted ||
          requestToken !== requestTokenRef.current
        ) {
          return;
        }
        setState((current) => ({
          ...current,
          error,
          failedMode: mode,
          failedOffset: offset,
          pendingMode: null,
          settled: true,
        }));
      } finally {
        if (requestToken === requestTokenRef.current) abortRef.current = null;
      }
    },
    [invalidateRequest, pluralLabel, readPage, singularLabel],
  );

  const refreshFromStart = useCallback(
    () => (activeRef.current ? requestPage("replace", 0) : Promise.resolve()),
    [requestPage],
  );

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (current.pendingMode || pausedRef.current || !current.hasMore) {
      return Promise.resolve();
    }
    return requestPage("append", current.nextOffset);
  }, [requestPage]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (!current.failedMode || current.pendingMode) return Promise.resolve();
    return requestPage(current.failedMode, current.failedOffset);
  }, [requestPage]);

  useEffect(() => {
    if (identityRef.current === identity) return;
    identityRef.current = identity;
    invalidateRequest();
    setState((current) => ({
      ...current,
      announcement: "",
      error: null,
      failedMode: null,
      hasMore: false,
      hasLoadedMore: false,
      pendingMode: null,
      settled: false,
    }));
    if (active) void requestPage("replace", 0);
  }, [active, identity, invalidateRequest, requestPage]);

  useEffect(() => {
    const wasActive = previousActiveRef.current;
    previousActiveRef.current = active;

    if (!active) {
      invalidateRequest();
      setState((current) => ({
        ...current,
        announcement: "",
        error: null,
        failedMode: null,
        hasMore: false,
        pendingMode: null,
        settled: false,
      }));
      return;
    }

    if (!wasActive) void refreshFromStart();
  }, [active, invalidateRequest, refreshFromStart]);

  useEffect(() => {
    if (
      !active ||
      initialPage !== undefined ||
      stateRef.current.settled ||
      abortRef.current
    )
      return;
    void refreshFromStart();
  }, [active, initialPage, refreshFromStart]);

  useEffect(() => {
    if (!active) return;

    const handleFocus = () => {
      if (
        shouldPollOffsetList({
          active,
          visible: document.visibilityState === "visible",
          busy: pausedRef.current,
        })
      ) {
        void refreshFromStart();
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [active, refreshFromStart]);

  useEffect(() => {
    if (!active || !pollIntervalMs) return;
    const interval = window.setInterval(() => {
      if (
        shouldPollOffsetList({
          active,
          visible: document.visibilityState === "visible",
          busy: pausedRef.current,
        })
      ) {
        void refreshFromStart();
      }
    }, pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [active, pollIntervalMs, refreshFromStart]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateRequest();
    };
  }, [invalidateRequest]);

  return {
    ...state,
    isInitialLoading: !state.settled && state.items.length === 0,
    isLoadingMore: state.pendingMode === "append",
    isRefreshing: state.pendingMode === "replace",
    loadMore,
    refreshFromStart,
    retry,
  };
}

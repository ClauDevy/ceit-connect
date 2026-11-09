"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Bell, CheckCheck, LoaderCircle, X } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadMoreControl } from "@/components/shared/load-more-control";
import { useListReveal } from "@/components/shared/motion";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  appendUniqueNotifications,
  formatNotificationRelativeTime,
  isModifiedNotificationActivation,
  markNotificationRowsRead,
  mergeRefreshedNotificationPage,
  normalizeNotificationPage,
  notificationBadgeLabel,
  notificationBellLabel,
  notificationCountAnnouncement,
  notificationSentence,
  NOTIFICATION_FETCH_LIMIT,
  parseMarkAllNotificationsReadResult,
  parseMarkNotificationReadResult,
  parseNotificationRows,
  parseNotificationUnreadCount,
  type NotificationCursor,
  type NotificationListState,
  type NotificationRow,
} from "@/lib/notifications/notification-bell";
import { subscribeToNotificationRealtime } from "@/lib/notifications/notification-realtime";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type OpenSurface = "desktop" | "mobile" | null;

const INITIAL_LIST_STATE: NotificationListState = {
  rows: [],
  loaded: false,
  loading: false,
  loadingMore: false,
  olderPagesLoaded: false,
  hasMore: false,
  cursor: null,
  error: null,
  appendError: null,
  announcement: "",
};

type NotificationContextValue = {
  count: number | null;
  countError: string | null;
  list: NotificationListState;
  openSurface: OpenSurface;
  busyIds: ReadonlySet<string>;
  markAllBusy: boolean;
  open: (surface: Exclude<OpenSurface, null>) => void;
  close: () => void;
  refreshList: () => void;
  loadMore: () => void;
  markOne: (id: string) => Promise<boolean>;
  markAll: () => Promise<void>;
};

const NotificationContext = createContext<NotificationContextValue | null>(null);

function useNotifications() {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("Notification bell must be inside its provider.");
  return value;
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
}

export function NotificationProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const mountedRef = useRef(false);
  const countRequestRef = useRef(0);
  const listRefreshRequestRef = useRef(0);
  const listAppendRequestRef = useRef(0);
  const listRef = useRef<NotificationListState>(INITIAL_LIST_STATE);
  const openRef = useRef<OpenSurface>(null);
  const busyIdsRef = useRef(new Set<string>());
  const markAllBusyRef = useRef(false);
  const [count, setCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [list, setList] = useState<NotificationListState>(INITIAL_LIST_STATE);
  const [openSurface, setOpenSurface] = useState<OpenSurface>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [markAllBusy, setMarkAllBusy] = useState(false);

  const updateList = useCallback((
    update: (current: NotificationListState) => NotificationListState,
  ) => {
    setList((current) => {
      const next = update(current);
      listRef.current = next;
      return next;
    });
  }, []);

  const handleInactiveDenial = useCallback(
    (error: unknown) => {
      if (errorCode(error) !== "42501") return false;
      router.refresh();
      return true;
    },
    [router],
  );

  const refreshCount = useCallback(async () => {
    const request = ++countRequestRef.current;
    try {
      const { data, error } = await supabase.rpc("get_notification_unread_count");
      if (error) throw error;
      const parsed = parseNotificationUnreadCount(data);
      if (parsed === null) throw new Error("Invalid notification count response.");
      if (!mountedRef.current || request !== countRequestRef.current) return;
      setCount(parsed);
      setCountError(null);
    } catch (error) {
      if (!mountedRef.current || request !== countRequestRef.current) return;
      if (!handleInactiveDenial(error)) {
        setCountError(
          "The unread count could not refresh. The last known count is still shown.",
        );
      }
    }
  }, [handleInactiveDenial, supabase]);

  const readPage = useCallback(
    async (cursor: NotificationCursor | null) => {
      const { data, error } = await supabase.rpc("list_notifications", {
        p_limit: NOTIFICATION_FETCH_LIMIT,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
      });
      if (error) throw error;
      const rows = parseNotificationRows(data);
      if (!rows) throw new Error("Invalid notification list response.");
      return normalizeNotificationPage(rows);
    },
    [supabase],
  );

  const refreshList = useCallback(async () => {
    const request = ++listRefreshRequestRef.current;
    listAppendRequestRef.current += 1;
    updateList((current) => ({
      ...current,
      loading: true,
      loadingMore: false,
      error: null,
    }));
    try {
      const refreshed = await readPage(null);
      if (!mountedRef.current || request !== listRefreshRequestRef.current) return;
      updateList((current) => ({
        ...current,
        ...mergeRefreshedNotificationPage({
          current: current.rows,
          refreshed,
          olderPagesLoaded: current.olderPagesLoaded,
          currentHasMore: current.hasMore,
          currentCursor: current.cursor,
        }),
        loaded: true,
        loading: false,
        error: null,
      }));
    } catch (error) {
      if (!mountedRef.current || request !== listRefreshRequestRef.current) return;
      handleInactiveDenial(error);
      updateList((current) => ({
        ...current,
        loading: false,
        error: current.loaded
          ? "Notifications could not refresh. The last loaded notifications are still shown."
          : "Notifications could not be loaded. Try again.",
      }));
    }
  }, [handleInactiveDenial, readPage, updateList]);

  const loadMore = useCallback(async () => {
    const current = listRef.current;
    if (current.loadingMore || current.loading || !current.hasMore || !current.cursor)
      return;
    const request = ++listAppendRequestRef.current;
    updateList((value) => ({
      ...value,
      loadingMore: true,
      appendError: null,
      announcement: "",
    }));
    try {
      const page = await readPage(current.cursor);
      if (!mountedRef.current || request !== listAppendRequestRef.current) return;
      updateList((value) => {
        const rows = appendUniqueNotifications(value.rows, page.items);
        const added = rows.length - value.rows.length;
        return {
          ...value,
          rows,
          hasMore: page.hasMore,
          cursor: page.cursor,
          olderPagesLoaded: true,
          loadingMore: false,
          appendError: null,
          announcement:
            added > 0
              ? `${added} older notification${added === 1 ? "" : "s"} loaded.`
              : "No additional notifications were loaded.",
        };
      });
    } catch (error) {
      if (!mountedRef.current || request !== listAppendRequestRef.current) return;
      handleInactiveDenial(error);
      updateList((value) => ({
        ...value,
        loadingMore: false,
        appendError:
          "More notifications could not be loaded. The loaded notifications are still shown.",
      }));
    }
  }, [handleInactiveDenial, readPage, updateList]);

  const recover = useCallback(() => {
    void refreshCount();
    if (openRef.current) void refreshList();
  }, [refreshCount, refreshList]);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(refreshCount);
    const unsubscribeRealtime = subscribeToNotificationRealtime(userId, recover);
    const handleFocus = () => recover();
    const handleOnline = () => recover();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") recover();
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mountedRef.current = false;
      countRequestRef.current += 1;
      listRefreshRequestRef.current += 1;
      listAppendRequestRef.current += 1;
      unsubscribeRealtime();
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [recover, refreshCount, userId]);

  const open = useCallback(
    (surface: Exclude<OpenSurface, null>) => {
      openRef.current = surface;
      setOpenSurface(surface);
      void refreshCount();
      void refreshList();
    },
    [refreshCount, refreshList],
  );

  const close = useCallback(() => {
    openRef.current = null;
    setOpenSurface(null);
  }, []);

  const markOne = useCallback(
    async (id: string) => {
      if (busyIdsRef.current.has(id) || markAllBusyRef.current) return false;
      busyIdsRef.current.add(id);
      setBusyIds(new Set(busyIdsRef.current));
      updateList((current) => ({ ...current, error: null }));
      try {
        const { data, error } = await supabase.rpc("mark_notification_read", {
          p_notification_id: id,
        });
        if (error) throw error;
        if (parseMarkNotificationReadResult(data) !== true) {
          throw new Error("Notification was not marked read.");
        }
        updateList((current) => ({
          ...current,
          rows: markNotificationRowsRead(current.rows, id, new Date().toISOString()),
        }));
        void refreshCount();
        void refreshList();
        return true;
      } catch (error) {
        handleInactiveDenial(error);
        updateList((current) => ({
          ...current,
          error: "This notification could not be marked as read. Try again.",
        }));
        return false;
      } finally {
        busyIdsRef.current.delete(id);
        if (mountedRef.current) setBusyIds(new Set(busyIdsRef.current));
      }
    },
    [handleInactiveDenial, refreshCount, refreshList, supabase, updateList],
  );

  const markAll = useCallback(async () => {
    if (markAllBusyRef.current) return;
    markAllBusyRef.current = true;
    setMarkAllBusy(true);
    updateList((current) => ({ ...current, error: null }));
    try {
      const { data, error } = await supabase.rpc("mark_all_notifications_read");
      if (error) throw error;
      if (parseMarkAllNotificationsReadResult(data) === null) {
        throw new Error("Invalid mark-all response.");
      }
      updateList((current) => ({
        ...current,
        rows: markNotificationRowsRead(current.rows, null, new Date().toISOString()),
      }));
      void refreshCount();
      void refreshList();
    } catch (error) {
      handleInactiveDenial(error);
      updateList((current) => ({
        ...current,
        error: "Notifications could not be marked as read. Try again.",
      }));
    } finally {
      markAllBusyRef.current = false;
      if (mountedRef.current) setMarkAllBusy(false);
    }
  }, [handleInactiveDenial, refreshCount, refreshList, supabase, updateList]);

  const context = useMemo<NotificationContextValue>(
    () => ({
      count,
      countError,
      list,
      openSurface,
      busyIds,
      markAllBusy,
      open,
      close,
      refreshList: () => void refreshList(),
      loadMore: () => void loadMore(),
      markOne,
      markAll,
    }),
    [
      busyIds,
      close,
      count,
      countError,
      list,
      loadMore,
      markAll,
      markAllBusy,
      markOne,
      open,
      openSurface,
      refreshList,
    ],
  );

  return (
    <NotificationContext.Provider value={context}>
      {children}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {notificationCountAnnouncement(count)}
      </p>
    </NotificationContext.Provider>
  );
}

function NotificationBellIcon({ count }: { count: number | null }) {
  const badge = notificationBadgeLabel(count);
  return (
    <span className="relative inline-flex">
      <Bell aria-hidden className="size-5" />
      {count !== null && count > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -top-2 -right-2 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-bold text-primary-foreground ring-2 ring-background",
            count > 99 && "-right-4",
          )}
        >
          {badge}
        </span>
      ) : null}
    </span>
  );
}

type NotificationRowsViewProps = {
  count: number | null;
  countError: string | null;
  list: NotificationListState;
  busyIds: ReadonlySet<string>;
  close: () => void;
  markOne: (id: string) => Promise<boolean>;
  refreshList: () => void;
  navigate: (taskId: string) => void;
};

export function NotificationRowsView({
  count,
  countError,
  list,
  busyIds,
  close,
  markOne,
  refreshList,
  navigate,
}: NotificationRowsViewProps) {
  const reveal = useListReveal({
    items: list.rows,
    settled: list.loaded && !list.loading,
    error: list.error,
    waitForSuccessfulData: true,
    getId: (row) => row.id,
  });

  function backgroundMark(row: NotificationRow) {
    if (row.readAt === null && !busyIds.has(row.id)) void markOne(row.id);
  }

  async function handleClick(event: MouseEvent<HTMLAnchorElement>, row: NotificationRow) {
    const taskId = row.taskId;
    if (!taskId) return;
    if (
      isModifiedNotificationActivation({
        button: event.button,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      })
    ) {
      backgroundMark(row);
      return;
    }
    if (row.readAt !== null) {
      close();
      return;
    }
    event.preventDefault();
    if (busyIds.has(row.id)) return;
    if (await markOne(row.id)) {
      close();
      navigate(taskId);
    }
  }

  if (
    list.rows.length === 0 &&
    (list.loading ||
      (!list.loaded && !list.error) ||
      (count === null && countError === null && !list.error))
  ) {
    return (
      <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground" role="status">
        <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        Loading notifications…
      </div>
    );
  }
  if (list.rows.length === 0 && list.error) return null;
  if (list.loaded && list.rows.length === 0 && count !== 0) {
    return (
      <EmptyState
        compact
        title="Notifications could not be displayed"
        description="Refresh the list to try again."
        action={
          <Button type="button" variant="outline" size="sm" onClick={refreshList}>
            Refresh
          </Button>
        }
      />
    );
  }
  if (list.loaded && list.rows.length === 0 && count === 0) {
    return (
      <EmptyState
        compact
        title="No notifications yet"
        description="New task updates will appear here."
      />
    );
  }

  return (
    <div className="divide-y divide-border/70">
      {list.rows.map((row) => {
        const sentence = notificationSentence(row);
        const relativeTime = formatNotificationRelativeTime(row.createdAt);
        const unread = row.readAt === null;
        const busy = busyIds.has(row.id);
        const content = (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                unread ? "bg-primary" : "bg-transparent",
              )}
            />
            <span className="min-w-0 flex-1">
              <span className={cn("line-clamp-2 text-sm", unread && "font-semibold")}>
                {sentence}
              </span>
              <time dateTime={row.createdAt} className="mt-1 block text-xs text-muted-foreground">
                {relativeTime}
              </time>
            </span>
            {busy ? (
              <LoaderCircle aria-hidden className="mt-1 size-4 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
            ) : null}
          </>
        );
        const accessibleLabel = `${sentence} ${relativeTime}.${unread ? " Unread." : ""}`;
        return (
          <div
            key={row.id}
            {...reveal.getRevealProps(row.id)}
            className={cn("relative", unread && "bg-primary/5")}
          >
            {row.taskId ? (
              <Link
                href={`/tasks/${row.taskId}`}
                aria-label={accessibleLabel}
                aria-busy={busy || undefined}
                onClick={(event) => void handleClick(event, row)}
                onAuxClick={(event) => {
                  if (event.button === 1) backgroundMark(row);
                }}
                className="flex min-h-16 w-full items-start gap-3 px-4 py-3 outline-none transition-colors duration-[var(--motion-interaction-duration)] hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 motion-reduce:transition-none"
              >
                {content}
              </Link>
            ) : (
              <div
                role="group"
                aria-label={accessibleLabel}
                className="flex min-h-16 items-start gap-3 px-4 py-3"
              >
                {content}
                {unread ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void markOne(row.id)}
                    aria-label={`Mark notification as read: ${sentence}`}
                    className="self-center"
                  >
                    Mark as read
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function NotificationRows() {
  const router = useRouter();
  const {
    count,
    countError,
    list,
    busyIds,
    close,
    markOne,
    refreshList,
  } = useNotifications();
  return (
    <NotificationRowsView
      count={count}
      countError={countError}
      list={list}
      busyIds={busyIds}
      close={close}
      markOne={markOne}
      refreshList={refreshList}
      navigate={(taskId) => router.push(`/tasks/${taskId}`)}
    />
  );
}

function NotificationPanelContent({ titleRef }: { titleRef: RefObject<HTMLHeadingElement | null> }) {
  const {
    count,
    countError,
    list,
    markAllBusy,
    refreshList,
    loadMore,
    markAll,
  } = useNotifications();
  const markAllEnabled = count === null || count > 0;
  return (
    <div className="flex max-h-[min(36rem,80dvh)] min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <h2 ref={titleRef} tabIndex={-1} className="min-w-0 flex-1 font-display text-lg font-semibold outline-none">
          Notifications
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!markAllEnabled || markAllBusy}
          aria-busy={markAllBusy || undefined}
          onClick={() => void markAll()}
        >
          {markAllBusy ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <CheckCheck aria-hidden />}
          Mark all as read
        </Button>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        <div className="space-y-2 p-2">
          {countError ? <InlineAlert>{countError}</InlineAlert> : null}
          {list.error ? (
            <InlineAlert className="flex flex-wrap items-center justify-between gap-2">
              <span>{list.error}</span>
              <Button type="button" variant="outline" size="sm" onClick={refreshList} disabled={list.loading}>
                Retry
              </Button>
            </InlineAlert>
          ) : null}
        </div>
        <NotificationRows />
        <div className="p-3">
          <LoadMoreControl
            announcement={list.announcement}
            errorMessage={list.appendError ?? undefined}
            hasLoadedMore={list.olderPagesLoaded}
            hasMore={list.hasMore}
            isLoading={list.loadingMore}
            onLoadMore={loadMore}
            onRetry={loadMore}
          />
        </div>
      </div>
    </div>
  );
}

export function DesktopNotificationBell() {
  const { count, openSurface, open, close } = useNotifications();
  const titleRef = useRef<HTMLHeadingElement>(null);
  return (
    <Popover
      modal="trap-focus"
      open={openSurface === "desktop"}
      onOpenChange={(next) => (next ? open("desktop") : close())}
    >
      <PopoverTrigger
        aria-label={notificationBellLabel(count)}
        className="motion-button-interaction inline-flex size-9 min-w-9 items-center justify-center rounded-md border border-transparent outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <NotificationBellIcon count={count} />
      </PopoverTrigger>
      <PopoverContent
        initialFocus={titleRef}
        finalFocus
        className="w-[min(25rem,calc(100vw-2rem))] overflow-hidden p-0"
      >
        <PopoverTitle className="sr-only">Notifications</PopoverTitle>
        <PopoverClose className="sr-only">Close notifications</PopoverClose>
        <NotificationPanelContent titleRef={titleRef} />
      </PopoverContent>
    </Popover>
  );
}

export function MobileNotificationBell() {
  const { count, openSurface, open, close } = useNotifications();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        ref={triggerRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={notificationBellLabel(count)}
        aria-expanded={openSurface === "mobile"}
        onClick={() => open("mobile")}
      >
        <NotificationBellIcon count={count} />
      </Button>
      <Sheet open={openSurface === "mobile"} onOpenChange={(next) => (next ? open("mobile") : close())}>
        <SheetContent
          initialFocus={titleRef}
          finalFocus={triggerRef}
          className="max-h-[85dvh] overflow-hidden p-0 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetTitle className="sr-only">Notifications</SheetTitle>
          <SheetDescription className="sr-only">Your task notifications.</SheetDescription>
          <SheetClose
            aria-label="Close notifications"
            className="absolute top-3 right-3 z-10 inline-flex size-11 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X aria-hidden className="size-5" />
          </SheetClose>
          <NotificationPanelContent titleRef={titleRef} />
        </SheetContent>
      </Sheet>
    </>
  );
}

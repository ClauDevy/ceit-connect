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
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  ArrowRightLeft,
  AtSign,
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarX,
  CheckCheck,
  Clock,
  HandHeart,
  LifeBuoy,
  LoaderCircle,
  LockOpen,
  Megaphone,
  Radio,
  Trash2,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";
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
  notificationTargetPath,
  NOTIFICATION_FETCH_LIMIT,
  parseMarkAllNotificationsReadResult,
  parseMarkNotificationReadResult,
  parseClearReadNotificationsResult,
  parseDeleteNotificationResult,
  parseNotificationRows,
  parseNotificationUnreadCount,
  removeNotificationRow,
  type NotificationCursor,
  type NotificationListState,
  type NotificationRow,
  type NotificationType,
} from "@/lib/notifications/notification-bell";
import { APP_TIME_ZONE } from "@/lib/timezone";
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
  clearReadBusy: boolean;
  actionError: string | null;
  open: (surface: Exclude<OpenSurface, null>) => void;
  close: () => void;
  refreshList: () => void;
  loadMore: () => void;
  markOne: (id: string) => Promise<boolean>;
  markAll: () => Promise<void>;
  deleteOne: (id: string) => Promise<boolean>;
  clearRead: () => Promise<void>;
};

const DELETE_SUCCESS_ANNOUNCEMENT = "Notification deleted.";
const DELETE_FAILURE_MESSAGE = "Notification could not be deleted. Try again.";
const CLEAR_SUCCESS_ANNOUNCEMENT = "Read notifications cleared.";
const CLEAR_FAILURE_MESSAGE = "Read notifications could not be cleared. Try again.";
const CLEAR_CONFIRM_TIMEOUT_MS = 5_000;

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
  const clearReadBusyRef = useRef(false);
  const [count, setCount] = useState<number | null>(null);
  const [countError, setCountError] = useState<string | null>(null);
  const [list, setList] = useState<NotificationListState>(INITIAL_LIST_STATE);
  const [openSurface, setOpenSurface] = useState<OpenSurface>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());
  const [markAllBusy, setMarkAllBusy] = useState(false);
  const [clearReadBusy, setClearReadBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionAnnouncement, setActionAnnouncement] = useState("");

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

  const refreshList = useCallback(async ({ authoritative = false } = {}) => {
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
        ...(authoritative
          ? {
              rows: refreshed.items,
              hasMore: refreshed.hasMore,
              cursor: refreshed.cursor,
              olderPagesLoaded: false,
              appendError: null,
              announcement: "",
            }
          : mergeRefreshedNotificationPage({
              current: current.rows,
              refreshed,
              olderPagesLoaded: current.olderPagesLoaded,
              currentHasMore: current.hasMore,
              currentCursor: current.cursor,
            })),
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
    setActionAnnouncement("");
    void refreshCount();
    if (openRef.current) void refreshList();
  }, [refreshCount, refreshList]);

  const recoverAuthoritatively = useCallback(() => {
    setActionAnnouncement("");
    void refreshCount();
    if (openRef.current) void refreshList({ authoritative: true });
  }, [refreshCount, refreshList]);

  useEffect(() => {
    mountedRef.current = true;
    void Promise.resolve().then(refreshCount);
    const unsubscribeRealtime = subscribeToNotificationRealtime(userId, recover);
    const handleFocus = () => recoverAuthoritatively();
    const handleOnline = () => recover();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") recoverAuthoritatively();
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
  }, [recover, recoverAuthoritatively, refreshCount, userId]);

  const open = useCallback(
    (surface: Exclude<OpenSurface, null>) => {
      setActionAnnouncement("");
      setActionError(null);
      openRef.current = surface;
      setOpenSurface(surface);
      void refreshCount();
      void refreshList({ authoritative: true });
    },
    [refreshCount, refreshList],
  );

  const close = useCallback(() => {
    openRef.current = null;
    setOpenSurface(null);
  }, []);

  const markOne = useCallback(
    async (id: string) => {
      if (
        busyIdsRef.current.has(id) ||
        markAllBusyRef.current ||
        clearReadBusyRef.current
      )
        return false;
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
    if (markAllBusyRef.current || clearReadBusyRef.current) return;
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

  const deleteOne = useCallback(
    async (id: string) => {
      if (
        busyIdsRef.current.has(id) ||
        markAllBusyRef.current ||
        clearReadBusyRef.current
      )
        return false;
      busyIdsRef.current.add(id);
      setBusyIds(new Set(busyIdsRef.current));
      setActionError(null);
      setActionAnnouncement("");
      try {
        const { data, error } = await supabase.rpc("delete_notification", {
          p_notification_id: id,
        });
        if (error) throw error;
        if (parseDeleteNotificationResult(data) === null) {
          setActionError(DELETE_FAILURE_MESSAGE);
          setActionAnnouncement(DELETE_FAILURE_MESSAGE);
          void refreshCount();
          void refreshList();
          return false;
        }
        updateList((current) => ({
          ...current,
          rows: removeNotificationRow(current.rows, id),
        }));
        setActionAnnouncement(DELETE_SUCCESS_ANNOUNCEMENT);
        void refreshCount();
        void refreshList();
        return true;
      } catch (error) {
        handleInactiveDenial(error);
        setActionError(DELETE_FAILURE_MESSAGE);
        setActionAnnouncement(DELETE_FAILURE_MESSAGE);
        return false;
      } finally {
        busyIdsRef.current.delete(id);
        if (mountedRef.current) setBusyIds(new Set(busyIdsRef.current));
      }
    },
    [handleInactiveDenial, refreshCount, refreshList, supabase, updateList],
  );

  const clearRead = useCallback(async () => {
    if (clearReadBusyRef.current || markAllBusyRef.current) return;
    clearReadBusyRef.current = true;
    setClearReadBusy(true);
    setActionError(null);
    setActionAnnouncement("");
    try {
      const { data, error } = await supabase.rpc("clear_read_notifications");
      if (error) throw error;
      parseClearReadNotificationsResult(data);
      setActionAnnouncement(CLEAR_SUCCESS_ANNOUNCEMENT);
      await Promise.all([
        refreshCount(),
        refreshList({ authoritative: true }),
      ]);
    } catch (error) {
      handleInactiveDenial(error);
      setActionError(CLEAR_FAILURE_MESSAGE);
      setActionAnnouncement(CLEAR_FAILURE_MESSAGE);
    } finally {
      clearReadBusyRef.current = false;
      if (mountedRef.current) setClearReadBusy(false);
    }
  }, [handleInactiveDenial, refreshCount, refreshList, supabase]);

  const context = useMemo<NotificationContextValue>(
    () => ({
      count,
      countError,
      list,
      openSurface,
      busyIds,
      markAllBusy,
      clearReadBusy,
      actionError,
      open,
      close,
      refreshList: () => void refreshList(),
      loadMore: () => void loadMore(),
      markOne,
      markAll,
      deleteOne,
      clearRead,
    }),
    [
      busyIds,
      close,
      clearRead,
      clearReadBusy,
      count,
      countError,
      actionError,
      deleteOne,
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
        {actionAnnouncement || notificationCountAnnouncement(count)}
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

const NOTIFICATION_ICONS: Record<NotificationType, LucideIcon> = {
  mention: AtSign,
  heads_up: Megaphone,
  assignment: UserPlus,
  status_change: ArrowRightLeft,
  unlock: LockOpen,
  backup_request: LifeBuoy,
  volunteer_offer: HandHeart,
  leave_requested: CalendarClock,
  leave_cancelled: CalendarX,
  leave_approved: CalendarCheck,
  leave_denied: CalendarX,
  task_due_soon: Clock,
  live_operation_prep: Radio,
};

export type NotificationFilter = "all" | "unread";

const dayKeyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE.iana,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Groups newest-first rows under Today / Yesterday / Earlier (Manila calendar days). */
export function groupNotificationsByDay(rows: readonly NotificationRow[], now = Date.now()) {
  const today = dayKeyFormatter.format(now);
  const yesterday = dayKeyFormatter.format(now - 86_400_000);
  const buckets: Record<"Today" | "Yesterday" | "Earlier", NotificationRow[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };
  for (const row of rows) {
    const time = Date.parse(row.createdAt);
    const key = Number.isFinite(time) ? dayKeyFormatter.format(time) : "";
    if (key === today) buckets.Today.push(row);
    else if (key === yesterday) buckets.Yesterday.push(row);
    else buckets.Earlier.push(row);
  }
  return (["Today", "Yesterday", "Earlier"] as const)
    .filter((label) => buckets[label].length > 0)
    .map((label) => ({ label, rows: buckets[label] }));
}

type NotificationRowsViewProps = {
  count: number | null;
  countError: string | null;
  list: NotificationListState;
  busyIds: ReadonlySet<string>;
  close: () => void;
  markOne: (id: string) => Promise<boolean>;
  deleteOne: (id: string) => Promise<boolean>;
  refreshList: () => void;
  navigate: (targetPath: string) => void;
  emptyFocusRef?: RefObject<HTMLElement | null>;
  filter?: NotificationFilter;
};

export function NotificationRowsView({
  count,
  countError,
  list,
  busyIds,
  close,
  markOne,
  deleteOne,
  refreshList,
  navigate,
  emptyFocusRef,
  filter = "all",
}: NotificationRowsViewProps) {
  const deleteButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusSequenceRef = useRef(0);
  const [focusAfterDelete, setFocusAfterDelete] = useState<{
    id: string | null;
    sequence: number;
  } | null>(null);
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

  useEffect(() => {
    if (!focusAfterDelete) return;
    if (focusAfterDelete.id === null) emptyFocusRef?.current?.focus();
    else deleteButtonRefs.current.get(focusAfterDelete.id)?.focus();
  }, [emptyFocusRef, focusAfterDelete]);

  async function handleDelete(row: NotificationRow) {
    const index = list.rows.findIndex((candidate) => candidate.id === row.id);
    const focusId = list.rows[index + 1]?.id ?? list.rows[index - 1]?.id ?? null;
    if (await deleteOne(row.id)) {
      setFocusAfterDelete({ id: focusId, sequence: ++focusSequenceRef.current });
    }
  }

  async function handleClick(event: MouseEvent<HTMLAnchorElement>, row: NotificationRow) {
    const targetPath = notificationTargetPath(row);
    if (!targetPath) return;
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
    if (busyIds.has(row.id)) {
      event.preventDefault();
      return;
    }
    event.preventDefault();
    if (row.readAt !== null) {
      close();
      navigate(targetPath);
      return;
    }
    if (await markOne(row.id)) {
      close();
      navigate(targetPath);
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

  const visibleRows =
    filter === "unread" ? list.rows.filter((row) => row.readAt === null) : list.rows;
  if (visibleRows.length === 0) {
    // Only the loaded page is filtered, so older unread items may still be on the server.
    if (filter === "unread" && list.hasMore) {
      return (
        <EmptyState
          compact
          title="No unread notifications loaded yet"
          description="Use Load more below to check older notifications."
        />
      );
    }
    return (
      <EmptyState
        compact
        title="You're all caught up"
        description="No unread notifications right now."
      />
    );
  }
  const groups = groupNotificationsByDay(visibleRows);

  return (
    <div>
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <p
            aria-hidden="true"
            className="sticky top-0 z-[1] border-b border-border/60 bg-popover/95 px-4 py-1.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase backdrop-blur-sm"
          >
            {group.label}
          </p>
          <div className="divide-y divide-border/60">
            {group.rows.map((row) => {
              const sentence = notificationSentence(row);
              const relativeTime = formatNotificationRelativeTime(row.createdAt);
              const unread = row.readAt === null;
              const busy = busyIds.has(row.id);
              const TypeIcon = NOTIFICATION_ICONS[row.type] ?? Bell;
              const content = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full",
                      unread ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                    )}
                  >
                    <TypeIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "line-clamp-2 text-sm leading-snug",
                        unread ? "font-semibold" : "text-foreground/80",
                      )}
                    >
                      {sentence}
                    </span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <time dateTime={row.createdAt}>{relativeTime}</time>
                      {unread ? (
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                      ) : null}
                    </span>
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
                  className={cn(
                    "relative flex items-stretch",
                    unread &&
                      "bg-primary/[0.06] before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary",
                  )}
                >
                  {notificationTargetPath(row) ? (
                    <Link
                      href={notificationTargetPath(row)!}
                      aria-label={accessibleLabel}
                      aria-busy={busy || undefined}
                      onClick={(event) => void handleClick(event, row)}
                      onAuxClick={(event) => {
                        if (event.button === 1) backgroundMark(row);
                      }}
                      className="flex min-h-[4.5rem] min-w-0 flex-1 items-start gap-3 py-3 pr-1 pl-4 outline-none transition-colors duration-[var(--motion-interaction-duration)] hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50 motion-reduce:transition-none"
                    >
                      {content}
                    </Link>
                  ) : (
                    <div
                      role="group"
                      aria-label={accessibleLabel}
                      className="flex min-h-[4.5rem] min-w-0 flex-1 items-start gap-3 py-3 pr-1 pl-4"
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
                  <Button
                    ref={(node) => {
                      if (node) deleteButtonRefs.current.set(row.id, node);
                      else deleteButtonRefs.current.delete(row.id);
                    }}
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy}
                    aria-busy={busy || undefined}
                    aria-label={`Delete notification permanently: ${sentence}`}
                    title="Delete notification"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void handleDelete(row);
                    }}
                    className="mr-1 min-h-11 min-w-11 self-center text-muted-foreground/60 hover:bg-destructive/10 hover:text-destructive"
                  >
                    {busy ? (
                      <LoaderCircle
                        aria-hidden
                        className="animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <Trash2 aria-hidden />
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function NotificationRows({
  emptyFocusRef,
  filter,
}: {
  emptyFocusRef: RefObject<HTMLElement | null>;
  filter: NotificationFilter;
}) {
  const router = useRouter();
  const {
    count,
    countError,
    list,
    busyIds,
    close,
    markOne,
    deleteOne,
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
      deleteOne={deleteOne}
      refreshList={refreshList}
      navigate={(targetPath) => {
        const target = new URL(targetPath, window.location.origin);
        if (
          target.pathname === window.location.pathname &&
          target.search === window.location.search
        ) {
          const repeatsCurrentTarget = target.hash === window.location.hash;
          window.location.hash = target.hash;
          if (repeatsCurrentTarget) window.dispatchEvent(new Event("hashchange"));
          return;
        }
        router.push(targetPath);
      }}
      emptyFocusRef={emptyFocusRef}
      filter={filter}
    />
  );
}

export function ClearReadControl({
  panelOpen,
  titleRef,
}: {
  panelOpen: boolean;
  titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const { clearRead, clearReadBusy } = useNotifications();
  const [armed, setArmed] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreClearFocusRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const reset = useCallback(
    ({ restoreFocus = false } = {}) => {
      clearTimer();
      restoreClearFocusRef.current =
        restoreFocus && document.activeElement === confirmButtonRef.current;
      setArmed(false);
    },
    [clearTimer],
  );

  useEffect(() => {
    if (armed) {
      confirmButtonRef.current?.focus();
    } else if (restoreClearFocusRef.current) {
      restoreClearFocusRef.current = false;
      clearButtonRef.current?.focus();
    }
  }, [armed]);

  useEffect(() => {
    if (!panelOpen) {
      clearTimer();
      queueMicrotask(() => setArmed(false));
    }
    return clearTimer;
  }, [clearTimer, panelOpen]);

  function arm() {
    clearTimer();
    setArmed(true);
    timerRef.current = setTimeout(
      () => reset({ restoreFocus: true }),
      CLEAR_CONFIRM_TIMEOUT_MS,
    );
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) reset();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    reset({ restoreFocus: true });
  }

  if (!armed) {
    return (
      <Button
        ref={clearButtonRef}
        type="button"
        variant="ghost"
        size="sm"
        disabled={clearReadBusy}
        aria-busy={clearReadBusy || undefined}
        onClick={arm}
      >
        Clear read
      </Button>
    );
  }

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="Confirm clearing read notifications"
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="motion-small-disclosure flex items-center gap-1 motion-reduce:transition-none"
    >
      <Button
        ref={confirmButtonRef}
        type="button"
        variant="destructive"
        size="sm"
        disabled={clearReadBusy}
        aria-busy={clearReadBusy || undefined}
        onClick={() => {
          clearTimer();
          setArmed(false);
          // The Confirm button unmounts here, so keep focus inside the panel.
          titleRef?.current?.focus();
          void clearRead();
        }}
      >
        {clearReadBusy ? (
          <LoaderCircle
            aria-hidden
            className="animate-spin motion-reduce:animate-none"
          />
        ) : null}
        Confirm clear read
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={clearReadBusy}
        onClick={() => reset()}
      >
        Cancel
      </Button>
    </div>
  );
}

function NotificationFilterTabs({
  filter,
  onChange,
  unreadCount,
}: {
  filter: NotificationFilter;
  onChange: (next: NotificationFilter) => void;
  unreadCount: number | null;
}) {
  const tabs: { value: NotificationFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "unread", label: "Unread" },
  ];
  return (
    <div
      role="group"
      aria-label="Filter notifications"
      className="flex w-full gap-1 rounded-lg bg-muted p-1"
    >
      {tabs.map((tab) => {
        const active = filter === tab.value;
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(tab.value)}
            className={cn(
              "flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium outline-none transition-colors duration-[var(--motion-interaction-duration)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
              active
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
            {tab.value === "unread" && unreadCount !== null && unreadCount > 0 ? (
              <span
                aria-hidden="true"
                className="rounded-full bg-primary px-1.5 text-[11px] leading-4 font-bold text-primary-foreground tabular-nums"
              >
                {notificationBadgeLabel(unreadCount)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function NotificationPanelContent({
  titleRef,
  closeSlot,
}: {
  titleRef: RefObject<HTMLHeadingElement | null>;
  closeSlot?: ReactNode;
}) {
  const {
    count,
    countError,
    list,
    markAllBusy,
    actionError,
    openSurface,
    refreshList,
    loadMore,
    markAll,
  } = useNotifications();
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const markAllEnabled = count === null || count > 0;
  return (
    <div className="flex max-h-[min(36rem,80dvh)] min-h-0 flex-col">
      <div className="shrink-0 space-y-3 border-b px-4 pt-4 pb-3">
        <div className="flex min-h-10 items-center gap-2.5">
          <h2
            ref={titleRef}
            tabIndex={-1}
            className="font-display text-lg font-semibold outline-none"
          >
            Notifications
          </h2>
          {count !== null && count > 0 ? (
            <span
              aria-hidden="true"
              className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums"
            >
              {notificationBadgeLabel(count)} new
            </span>
          ) : null}
          {closeSlot ? <div className="ml-auto">{closeSlot}</div> : null}
        </div>
        <NotificationFilterTabs filter={filter} onChange={setFilter} unreadCount={count} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {countError || actionError || list.error ? (
          <div className="space-y-2 p-2">
            {countError ? <InlineAlert>{countError}</InlineAlert> : null}
            {actionError ? <InlineAlert>{actionError}</InlineAlert> : null}
            {list.error ? (
              <InlineAlert className="flex flex-wrap items-center justify-between gap-2">
                <span>{list.error}</span>
                <Button type="button" variant="outline" size="sm" onClick={refreshList} disabled={list.loading}>
                  Retry
                </Button>
              </InlineAlert>
            ) : null}
          </div>
        ) : null}
        <NotificationRows emptyFocusRef={titleRef} filter={filter} />
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
      <div className="shrink-0 border-t bg-popover px-3 py-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!markAllEnabled || markAllBusy}
            aria-busy={markAllBusy || undefined}
            onClick={() => void markAll()}
          >
            {markAllBusy ? <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" /> : <CheckCheck aria-hidden />}
            Mark all as read
          </Button>
          {list.rows.length > 0 ? (
            <ClearReadControl panelOpen={openSurface !== null} titleRef={titleRef} />
          ) : null}
        </div>
        <p className="mt-2 px-0.5 text-[11px] leading-snug text-muted-foreground">
          Deletion is permanent. Unread notifications are never removed.
        </p>
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
        className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden p-0"
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
          className="max-h-[85dvh] overflow-hidden p-0 pt-2 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetTitle className="sr-only">Notifications</SheetTitle>
          <SheetDescription className="sr-only">Your task notifications.</SheetDescription>
          <NotificationPanelContent
            titleRef={titleRef}
            closeSlot={
              <SheetClose
                aria-label="Close notifications"
                className="inline-flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <X aria-hidden className="size-5" />
              </SheetClose>
            }
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

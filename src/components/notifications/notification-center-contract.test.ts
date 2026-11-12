import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const center = read("src/components/notifications/notification-center.tsx");
const realtime = read("src/lib/notifications/notification-realtime.ts");
const appShell = read("src/components/layout/app-shell.tsx");
const desktop = read("src/components/layout/desktop-header.tsx");
const mobile = read("src/components/layout/mobile-topbar.tsx");
const popover = read("src/components/ui/popover.tsx");

describe("notification center application contract", () => {
  it("mounts one provider above both responsive headers", () => {
    expect(appShell.match(/<NotificationProvider/g)).toHaveLength(1);
    expect(appShell.indexOf("<NotificationProvider")).toBeLessThan(
      appShell.indexOf("<MobileTopbar"),
    );
    expect(desktop.indexOf("<ThemeToggle")).toBeLessThan(
      desktop.indexOf("<DesktopNotificationBell"),
    );
    expect(desktop.indexOf("<DesktopNotificationBell")).toBeLessThan(
      desktop.indexOf("<UserCard"),
    );
    expect(mobile.indexOf("<ThemeToggle")).toBeLessThan(
      mobile.indexOf("<MobileNotificationBell"),
    );
    expect(mobile.indexOf("<MobileNotificationBell")).toBeLessThan(
      mobile.indexOf("<AvatarMenu"),
    );
  });

  it("uses the approved notification RPCs and never performs badge arithmetic", () => {
    for (const rpc of [
      "get_notification_unread_count",
      "list_notifications",
      "mark_notification_read",
      "mark_all_notifications_read",
      "delete_notification",
      "clear_read_notifications",
    ]) {
      expect(center).toContain(`rpc(\"${rpc}\"`);
    }
    expect(center).not.toMatch(/setCount\s*\(\s*\(?\s*(current|value)/);
    expect(center).not.toMatch(/count\s*[+-]\s*1/);
  });

  it("recovers through focus, visibility, online, channel state, and token refresh", () => {
    expect(center).toContain('window.addEventListener("focus"');
    expect(center).toContain('window.addEventListener("online"');
    expect(center).toContain('document.addEventListener("visibilitychange"');
    expect(realtime).toContain('status === "CHANNEL_ERROR"');
    expect(realtime).toContain('status === "TIMED_OUT"');
    expect(realtime).toContain('event !== "TOKEN_REFRESHED"');
    expect(realtime).toContain("client.realtime.setAuth(session.access_token)");
  });

  it("refreshes an open panel once per recovery event without a loaded gate or loop", () => {
    const recoverStart = center.indexOf("const recover = useCallback");
    const refreshListStart = center.indexOf("const refreshList = useCallback");
    expect(recoverStart).toBeGreaterThanOrEqual(0);
    expect(refreshListStart).toBeGreaterThanOrEqual(0);
    const recover = center.slice(
      recoverStart,
      center.indexOf("useEffect(() =>", recoverStart),
    );
    const refreshList = center.slice(
      refreshListStart,
      center.indexOf("const loadMore = useCallback"),
    );
    expect(recover.match(/void refreshList\(\)/g)).toHaveLength(1);
    expect(recover).not.toContain("listRef.current.loaded");
    expect(refreshList).not.toContain("recover(");
  });

  it("keeps Realtime personal, invalidation-only, deduplicated, and cleaned up", () => {
    expect(realtime).toContain('event: "INSERT"');
    expect(realtime).toContain('table: "notifications"');
    expect(realtime).toContain('filter: `user_id=eq.${userId}`');
    expect(realtime).toContain("const realtimeEntries = new Map");
    expect(realtime).toContain("queueMicrotask");
    expect(realtime).toContain("client.removeChannel");
    expect(realtime).not.toContain("setCount");
  });

  it("preserves native modified clicks and blocks ordinary navigation until read succeeds", () => {
    const handleClick = center.slice(
      center.indexOf("async function handleClick"),
      center.indexOf("if (list.loading && !list.loaded)"),
    );
    expect(center).toContain("isModifiedNotificationActivation");
    expect(center).toContain("onAuxClick");
    expect(center).toContain("event.preventDefault()");
    expect(center).toContain("if (await markOne(row.id))");
    expect(center).toContain("busyIdsRef.current.has(id)");
    expect(handleClick.indexOf("isModifiedNotificationActivation")).toBeLessThan(
      handleClick.indexOf("if (row.readAt !== null)"),
    );
    expect(handleClick).toContain("navigate(targetPath)");
    expect(center).toContain("window.location.hash = target.hash");
  });

  it("renders hidden rows without a link and accessible labels with the full sentence", () => {
    expect(center).toContain("{notificationTargetPath(row) ? (");
    expect(center).toContain("href={notificationTargetPath(row)!}");
    expect(center).toContain("aria-label={accessibleLabel}");
    expect(center).toContain("Mark notification as read: ${sentence}");
    expect(center).not.toContain("dangerouslySetInnerHTML");
  });

  it("uses shared motion with reduced-motion fallbacks and only the fixed confirm timeout", () => {
    expect(center).toContain("useListReveal");
    expect(center).not.toContain("setInterval");
    expect(center.match(/setTimeout\(/g)).toHaveLength(1);
    expect(center).toContain("CLEAR_CONFIRM_TIMEOUT_MS = 5_000");
    expect(center).toContain("clearTimeout(timerRef.current)");
    expect(center).toContain("motion-small-disclosure");
    expect(popover).toContain("duration-[var(--motion-enter-duration)]");
    expect(popover).toContain("data-[ending-style]:duration-[var(--motion-exit-duration)]");
    expect(popover).toContain("motion-reduce:transition-none");
  });

  it("settles both mutations through finally and enables mark-all from count state", () => {
    expect(center.match(/finally \{/g)?.length).toBeGreaterThanOrEqual(4);
    expect(center).toContain("const markAllEnabled = count === null || count > 0");
    expect(center).toContain("rows: markNotificationRowsRead(current.rows, id");
    expect(center).toContain("rows: markNotificationRowsRead(current.rows, null");
  });

  it("keeps delete separate from navigation and makes recovery authoritative", () => {
    expect(center).toContain("event.stopPropagation()");
    expect(center).toContain("Delete notification permanently:");
    expect(center).toContain("min-h-11 min-w-11");
    expect(center).toContain("refreshList({ authoritative: true })");
    expect(center).toContain("recoverAuthoritatively");
    expect(realtime).toContain('event: "INSERT"');
    expect(realtime).not.toContain('event: "DELETE"');
  });
});

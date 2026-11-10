// @vitest-environment happy-dom

import * as React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  router: { push: vi.fn(), refresh: vi.fn() },
  recover: null as null | (() => void),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/notifications/notification-realtime", () => ({
  subscribeToNotificationRealtime: (_userId: string, recover: () => void) => {
    mocks.recover = recover;
    return vi.fn();
  },
}));

vi.mock("@/components/shared/motion", () => ({
  useListReveal: () => ({ getRevealProps: () => ({}) }),
}));

vi.mock("@/components/ui/sheet", () => {
  const SheetContext = React.createContext<((open: boolean) => void) | null>(null);
  const Surface = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  const Sheet = ({
    children,
    onOpenChange,
  }: {
    children?: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <SheetContext.Provider value={onOpenChange ?? null}>
      {children}
    </SheetContext.Provider>
  );
  const SheetClose = ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => {
    const onOpenChange = React.useContext(SheetContext);
    return (
      <button
        type="button"
        {...props}
        onClick={(event) => {
          onClick?.(event);
          onOpenChange?.(false);
        }}
      >
        {children}
      </button>
    );
  };
  return {
    Sheet,
    SheetContent: Surface,
    SheetDescription: Surface,
    SheetTitle: Surface,
    SheetClose,
  };
});

import {
  MobileNotificationBell,
  NotificationProvider,
} from "./notification-center";

const USER_ID = "90000000-0000-4000-8000-000000000001";

function rpcRow(index: number, read = false) {
  const suffix = String(index + 1).padStart(12, "0");
  return {
    out_id: `10000000-0000-4000-8000-${suffix}`,
    out_type: "mention",
    out_task_id: `20000000-0000-4000-8000-${suffix}`,
    out_task_title: `Task ${index + 1}`,
    out_read_at: read ? "2026-11-08T18:05:28.933426+00:00" : null,
    out_created_at: `2026-11-08T09:16:${String(59 - index).padStart(2, "0")}.532708+00:00`,
  };
}

const PROD_ROW = {
  out_id: "10000000-0000-4000-8000-000000000001",
  out_type: "mention",
  out_task_id: "20000000-0000-4000-8000-000000000001",
  out_task_title: "Orientation",
  out_read_at: "2026-11-08T18:05:28.933426+00:00",
  out_created_at: "2026-11-08T09:16:52.532708+00:00",
};

function ok(data: unknown) {
  return Promise.resolve({ data, error: null });
}

async function renderCenter() {
  render(
    <NotificationProvider userId={USER_ID}>
      <MobileNotificationBell />
    </NotificationProvider>,
  );
  await waitFor(() => expect(mocks.recover).not.toBeNull());
  fireEvent.click(screen.getByRole("button", { name: /Notifications,/ }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recover = null;
});

describe("notification housekeeping interactions", () => {
  it("renders the exact Prod row and treats delete false as success", async () => {
    let deleted = false;
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok(deleted ? [] : [PROD_ROW]);
      if (name === "delete_notification") {
        deleted = true;
        return ok(false);
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    expect(await screen.findByText("You were mentioned in Orientation.")).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete notification permanently: You were mentioned in Orientation.",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByText("You were mentioned in Orientation.")).toBeNull();
    });
    expect(screen.getByRole("status").textContent).toBe("Notification deleted.");
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Notifications" }));
  });

  it("keeps the row for delete failure and malformed success responses", async () => {
    for (const response of [
      { data: null, error: { code: "XX000" } },
      { data: "true", error: null },
    ]) {
      mocks.rpc.mockImplementation((name: string) => {
        if (name === "get_notification_unread_count") return ok(0);
        if (name === "list_notifications") return ok([PROD_ROW]);
        if (name === "delete_notification") return Promise.resolve(response);
        throw new Error(`Unexpected RPC: ${name}`);
      });
      await renderCenter();
      await screen.findByText("You were mentioned in Orientation.");
      fireEvent.click(screen.getByRole("button", { name: /Delete notification permanently/ }));
      expect((await screen.findByRole("alert")).textContent).toBe(
        "Notification could not be deleted. Try again.",
      );
      expect(screen.getByText("You were mentioned in Orientation.")).toBeDefined();
      cleanup();
      vi.clearAllMocks();
    }
  });

  it("blocks delete while mark-one owns the row", async () => {
    let resolveMark!: (value: { data: boolean; error: null }) => void;
    const mark = new Promise<{ data: boolean; error: null }>((resolve) => {
      resolveMark = resolve;
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(1);
      if (name === "list_notifications") return ok([rpcRow(0)]);
      if (name === "mark_notification_read") return mark;
      if (name === "delete_notification") return ok(true);
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    const link = await screen.findByRole("link", { name: /You were mentioned in Task 1/ });
    fireEvent.click(link);
    const deleteButton = screen.getByRole("button", { name: /Delete notification permanently/ });
    expect(deleteButton.hasAttribute("disabled")).toBe(true);
    fireEvent.click(deleteButton);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "delete_notification")).toHaveLength(0);
    resolveMark({ data: true, error: null });
  });

  it("sends one delete RPC for a double activation while busy", async () => {
    let resolveDelete!: (value: { data: boolean; error: null }) => void;
    const pending = new Promise<{ data: boolean; error: null }>((resolve) => {
      resolveDelete = resolve;
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok([PROD_ROW]);
      if (name === "delete_notification") return pending;
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    const deleteButton = await screen.findByRole("button", {
      name: /Delete notification permanently/,
    });
    fireEvent.click(deleteButton);
    fireEvent.click(deleteButton);

    expect(mocks.rpc.mock.calls.filter(([name]) => name === "delete_notification")).toHaveLength(1);
    await act(async () => resolveDelete({ data: true, error: null }));
  });

  it("clears an identical delete announcement before announcing it again", async () => {
    let rows = [rpcRow(0), rpcRow(1)];
    let deleteCall = 0;
    let resolveSecondDelete!: (value: { data: boolean; error: null }) => void;
    const secondDelete = new Promise<{ data: boolean; error: null }>((resolve) => {
      resolveSecondDelete = resolve;
    });
    mocks.rpc.mockImplementation((name: string, args?: { p_notification_id?: string }) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok(rows);
      if (name === "delete_notification") {
        deleteCall += 1;
        rows = rows.filter((row) => row.out_id !== args?.p_notification_id);
        return deleteCall === 1 ? ok(true) : secondDelete;
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    await screen.findByText("You were mentioned in Task 1.");
    fireEvent.click(screen.getByRole("button", {
      name: "Delete notification permanently: You were mentioned in Task 1.",
    }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Notification deleted."));

    fireEvent.click(screen.getByRole("button", {
      name: "Delete notification permanently: You were mentioned in Task 2.",
    }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("No unread notifications."));
    await act(async () => resolveSecondDelete({ data: true, error: null }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Notification deleted."));
  });

  it("focuses the next Delete after a middle row and the previous Delete after the last row", async () => {
    let rows = [rpcRow(0), rpcRow(1), rpcRow(2)];
    mocks.rpc.mockImplementation((name: string, args?: { p_notification_id?: string }) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok(rows);
      if (name === "delete_notification") {
        rows = rows.filter((row) => row.out_id !== args?.p_notification_id);
        return ok(true);
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    await screen.findByText("You were mentioned in Task 2.");
    fireEvent.click(screen.getByRole("button", {
      name: "Delete notification permanently: You were mentioned in Task 2.",
    }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", {
      name: "Delete notification permanently: You were mentioned in Task 3.",
    })));

    fireEvent.click(screen.getByRole("button", {
      name: "Delete notification permanently: You were mentioned in Task 3.",
    }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", {
      name: "Delete notification permanently: You were mentioned in Task 1.",
    })));
  });

  it("deletes with older pages loaded while keeping the cursor and deduplicating", async () => {
    const first = Array.from({ length: 21 }, (_, index) => rpcRow(index));
    const older = Array.from({ length: 21 }, (_, index) => rpcRow(index + 20));
    let listCall = 0;
    mocks.rpc.mockImplementation((name: string, args?: { p_before_id?: string }) => {
      if (name === "get_notification_unread_count") return ok(42);
      if (name === "list_notifications") {
        listCall += 1;
        if (listCall === 1 || listCall === 3) return ok(first);
        if (listCall === 2) return ok(older);
        expect(args?.p_before_id).toBe(rpcRow(39).out_id);
        return ok([rpcRow(40), rpcRow(41)]);
      }
      if (name === "delete_notification") return ok(true);
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    await screen.findByText("You were mentioned in Task 1.");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("You were mentioned in Task 22.");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Delete notification permanently: You were mentioned in Task 22.",
      }),
    );
    await waitFor(() => {
      expect(screen.queryByText("You were mentioned in Task 22.")).toBeNull();
    });
    await waitFor(() => expect(listCall).toBe(3));
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("You were mentioned in Task 41.")).toBeDefined();
    expect(screen.getAllByText("You were mentioned in Task 21.")).toHaveLength(1);
  });

  it("uses two-step clear, ignores a malformed informational count, and drops older pages", async () => {
    const first = Array.from({ length: 21 }, (_, index) => rpcRow(index, index % 2 === 0));
    let cleared = false;
    let listCall = 0;
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(cleared ? 0 : 10);
      if (name === "list_notifications") {
        listCall += 1;
        if (cleared) return ok([rpcRow(1, false)]);
        return ok(listCall === 1 ? first : [rpcRow(21, true)]);
      }
      if (name === "clear_read_notifications") {
        cleared = true;
        return ok("not-a-count");
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    await screen.findByText("You were mentioned in Task 1.");
    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("You were mentioned in Task 22.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    expect(screen.getByRole("button", { name: "Confirm clear read" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear read" }));

    await waitFor(() => {
      expect(screen.queryByText("You were mentioned in Task 22.")).toBeNull();
    });
    expect(screen.getByText("You were mentioned in Task 2.")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("Read notifications cleared.");
  });

  it("moves focus to Confirm clear read when confirmation is armed", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok([PROD_ROW]);
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    fireEvent.click(await screen.findByRole("button", { name: "Clear read" }));

    expect(screen.getByRole("button", { name: "Confirm clear read" })).toBe(document.activeElement);
  });

  it("moves focus to the panel heading after clear is confirmed", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok([PROD_ROW]);
      if (name === "clear_read_notifications") return ok(1);
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    fireEvent.click(await screen.findByRole("button", { name: "Clear read" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear read" }));

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Notifications" }));
  });

  it("resets clear confirmation on cancel, blur, Escape, timeout, and unmount", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok([PROD_ROW]);
      throw new Error(`Unexpected RPC: ${name}`);
    });
    await renderCenter();
    await screen.findByRole("button", { name: "Clear read" });
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Clear read" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    fireEvent.blur(screen.getByRole("button", { name: "Confirm clear read" }), {
      relatedTarget: screen.getByRole("heading", { name: "Notifications" }),
    });
    expect(screen.getByRole("button", { name: "Clear read" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    const confirm = screen.getByRole("button", { name: "Confirm clear read" });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Clear read" })).toBe(document.activeElement);

    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    screen.getByRole("button", { name: "Confirm clear read" }).focus();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByRole("button", { name: "Clear read" })).toBe(document.activeElement);

    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    cleanup();
    await vi.runAllTimersAsync();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "clear_read_notifications")).toHaveLength(0);
  });

  it("resets clear confirmation and clears its timer when the panel closes", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok([PROD_ROW]);
      throw new Error(`Unexpected RPC: ${name}`);
    });
    await renderCenter();
    await screen.findByRole("button", { name: "Clear read" });
    vi.useFakeTimers();

    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    expect(screen.getByRole("button", { name: "Confirm clear read" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /Notifications,/ }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Confirm clear read" })).toBeNull();
    expect(screen.getByRole("button", { name: "Clear read" })).toBeDefined();
    await vi.runAllTimersAsync();
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "clear_read_notifications")).toHaveLength(0);
  });

  it("prevents a double clear while busy and retains rows on clear failure", async () => {
    let resolveClear!: (value: { data: number; error: null }) => void;
    const pending = new Promise<{ data: number; error: null }>((resolve) => {
      resolveClear = resolve;
    });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok([PROD_ROW]);
      if (name === "clear_read_notifications") return pending;
      throw new Error(`Unexpected RPC: ${name}`);
    });
    await renderCenter();
    await screen.findByText("You were mentioned in Orientation.");
    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    const confirm = screen.getByRole("button", { name: "Confirm clear read" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mocks.rpc.mock.calls.filter(([name]) => name === "clear_read_notifications")).toHaveLength(1);
    resolveClear({ data: 1, error: null });
    cleanup();

    vi.clearAllMocks();
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok([PROD_ROW]);
      if (name === "clear_read_notifications") {
        return Promise.resolve({ data: null, error: { code: "XX000" } });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });
    await renderCenter();
    await screen.findByText("You were mentioned in Orientation.");
    fireEvent.click(screen.getByRole("button", { name: "Clear read" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear read" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Read notifications could not be cleared. Try again.",
    );
    expect(screen.getByText("You were mentioned in Orientation.")).toBeDefined();
  });

  it("reconciles external deletion on focus and visibility return", async () => {
    let rows = [PROD_ROW];
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(rows.length);
      if (name === "list_notifications") return ok(rows);
      throw new Error(`Unexpected RPC: ${name}`);
    });
    await renderCenter();
    await screen.findByText("You were mentioned in Orientation.");
    rows = [];
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByText("You were mentioned in Orientation.")).toBeNull());

    rows = [PROD_ROW];
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    fireEvent(document, new Event("visibilitychange"));
    expect(await screen.findByText("You were mentioned in Orientation.")).toBeDefined();
  });

  it("reconciles an external deletion when the panel reopens", async () => {
    let rows = [PROD_ROW];
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(rows.length);
      if (name === "list_notifications") return ok(rows);
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    await screen.findByText("You were mentioned in Orientation.");
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    rows = [];
    fireEvent.click(screen.getByRole("button", { name: /Notifications,/ }));

    await waitFor(() => expect(screen.queryByText("You were mentioned in Orientation.")).toBeNull());
    expect(screen.getByText("No notifications yet")).toBeDefined();
  });

  it("clears an old action failure when the panel reopens", async () => {
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") return ok(0);
      if (name === "list_notifications") return ok([PROD_ROW]);
      if (name === "delete_notification") {
        return Promise.resolve({ data: null, error: { code: "XX000" } });
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    await renderCenter();
    await screen.findByText("You were mentioned in Orientation.");
    fireEvent.click(screen.getByRole("button", { name: /Delete notification permanently/ }));
    expect(await screen.findByRole("alert")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Close notifications" }));
    fireEvent.click(screen.getByRole("button", { name: /Notifications,/ }));

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("ignores late stale count and list responses after newer readers settle", async () => {
    type RpcResult = { data: unknown; error: null };
    const countResolvers: Array<(value: RpcResult) => void> = [];
    const listResolvers: Array<(value: RpcResult) => void> = [];
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_notification_unread_count") {
        return new Promise<RpcResult>((resolve) => countResolvers.push(resolve));
      }
      if (name === "list_notifications") {
        return new Promise<RpcResult>((resolve) => listResolvers.push(resolve));
      }
      throw new Error(`Unexpected RPC: ${name}`);
    });

    render(
      <NotificationProvider userId={USER_ID}>
        <MobileNotificationBell />
      </NotificationProvider>,
    );
    await waitFor(() => expect(countResolvers).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: /Notifications,/ }));
    await waitFor(() => {
      expect(countResolvers).toHaveLength(2);
      expect(listResolvers).toHaveLength(1);
    });
    fireEvent.focus(window);
    await waitFor(() => {
      expect(countResolvers).toHaveLength(3);
      expect(listResolvers).toHaveLength(2);
    });

    await act(async () => {
      countResolvers[2]({ data: 7, error: null });
      listResolvers[1]({ data: [rpcRow(1)], error: null });
    });
    expect(await screen.findByText("You were mentioned in Task 2.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Notifications, 7 unread" })).toBeDefined();

    await act(async () => {
      countResolvers[0]({ data: 99, error: null });
      countResolvers[1]({ data: 98, error: null });
      listResolvers[0]({ data: [PROD_ROW], error: null });
    });
    expect(screen.getByText("You were mentioned in Task 2.")).toBeDefined();
    expect(screen.queryByText("You were mentioned in Orientation.")).toBeNull();
    expect(screen.getByRole("button", { name: "Notifications, 7 unread" })).toBeDefined();
  });
});

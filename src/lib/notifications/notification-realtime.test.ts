import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const state = {
    change: null as null | (() => void),
    status: null as null | ((status: string) => void),
    auth: null as null | ((event: string, session: { access_token: string } | null) => void),
  };
  const channel = {
    on: vi.fn((_kind, _filter, callback) => {
      state.change = callback;
      return channel;
    }),
    subscribe: vi.fn((callback) => {
      state.status = callback;
      return channel;
    }),
  };
  const client = {
    channel: vi.fn((topic: string) => {
      void topic;
      return channel;
    }),
    removeChannel: vi.fn(async () => "ok"),
    realtime: { setAuth: vi.fn(async () => undefined) },
    auth: {
      onAuthStateChange: vi.fn((callback) => {
        state.auth = callback;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
    },
  };
  return { state, channel, client };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => mocks.client,
}));

import { subscribeToNotificationRealtime } from "./notification-realtime";

const userId = "10000000-0000-4000-8000-000000000001";

describe("notification Realtime registry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.change = null;
    mocks.state.status = null;
    mocks.state.auth = null;
  });

  it("shares one personal channel, invalidates only, and removes it after the final release", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const releaseFirst = subscribeToNotificationRealtime(userId, first);
    const releaseSecond = subscribeToNotificationRealtime(userId, second);

    expect(mocks.client.channel).toHaveBeenCalledTimes(1);
    expect(mocks.channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      expect.objectContaining({
        event: "INSERT",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      }),
      expect.any(Function),
    );
    mocks.state.change?.();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.resolve();
    expect(mocks.client.removeChannel).not.toHaveBeenCalled();
    releaseSecond();
    await Promise.resolve();
    expect(mocks.client.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("survives a development cleanup/remount without creating a duplicate channel", async () => {
    const releaseFirst = subscribeToNotificationRealtime(userId, vi.fn());
    releaseFirst();
    const releaseSecond = subscribeToNotificationRealtime(userId, vi.fn());
    await Promise.resolve();
    expect(mocks.client.channel).toHaveBeenCalledTimes(1);
    expect(mocks.client.removeChannel).not.toHaveBeenCalled();
    releaseSecond();
    await Promise.resolve();
  });

  it("uses a different topic for entries mounted and unmounted in sequence", async () => {
    const releaseFirst = subscribeToNotificationRealtime(userId, vi.fn());
    const firstTopic = mocks.client.channel.mock.calls[0]?.[0];
    releaseFirst();
    await Promise.resolve();

    const releaseSecond = subscribeToNotificationRealtime(userId, vi.fn());
    const secondTopic = mocks.client.channel.mock.calls[1]?.[0];
    expect(mocks.client.channel).toHaveBeenCalledTimes(2);
    expect(firstTopic).not.toBe(secondTopic);

    releaseSecond();
    await Promise.resolve();
  });

  it("recovers on live errors, timeout, subscription, and token refresh", async () => {
    const recover = vi.fn();
    const release = subscribeToNotificationRealtime(userId, recover);
    mocks.state.status?.("CHANNEL_ERROR");
    mocks.state.status?.("TIMED_OUT");
    mocks.state.status?.("SUBSCRIBED");
    mocks.state.auth?.("TOKEN_REFRESHED", { access_token: "new-token" });
    expect(recover).toHaveBeenCalledTimes(4);
    expect(mocks.client.realtime.setAuth).toHaveBeenCalledWith("new-token");
    release();
    await Promise.resolve();
  });
});

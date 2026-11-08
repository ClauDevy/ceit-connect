import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

type RealtimeListener = {
  recover: () => void;
};

type RealtimeEntry = {
  client: SupabaseClient;
  listeners: Set<RealtimeListener>;
  channel: ReturnType<SupabaseClient["channel"]>;
  authUnsubscribe: () => void;
};

const realtimeEntries = new Map<string, RealtimeEntry>();
let realtimeEntrySequence = 0;

function notify(entry: RealtimeEntry) {
  for (const listener of entry.listeners) listener.recover();
}

function createEntry(userId: string): RealtimeEntry {
  const client = createClient();
  const listeners = new Set<RealtimeListener>();
  const entry = {} as RealtimeEntry;
  const channel = client
    .channel(`notification-bell:${userId}:${++realtimeEntrySequence}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${userId}`,
      },
      () => notify(entry),
    )
    .subscribe((status) => {
      if (
        status === "SUBSCRIBED" ||
        status === "CHANNEL_ERROR" ||
        status === "TIMED_OUT"
      ) {
        notify(entry);
      }
    });
  const { data } = client.auth.onAuthStateChange((event, session) => {
    if (event !== "TOKEN_REFRESHED") return;
    if (session?.access_token) void client.realtime.setAuth(session.access_token);
    notify(entry);
  });
  Object.assign(entry, {
    client,
    listeners,
    channel,
    authUnsubscribe: () => data.subscription.unsubscribe(),
  });
  return entry;
}

export function subscribeToNotificationRealtime(
  userId: string,
  recover: () => void,
) {
  let entry = realtimeEntries.get(userId);
  if (!entry) {
    entry = createEntry(userId);
    realtimeEntries.set(userId, entry);
  }
  const listener = { recover };
  entry.listeners.add(listener);
  let released = false;

  return () => {
    if (released) return;
    released = true;
    entry!.listeners.delete(listener);
    queueMicrotask(() => {
      if (entry!.listeners.size > 0 || realtimeEntries.get(userId) !== entry) return;
      realtimeEntries.delete(userId);
      entry!.authUnsubscribe();
      void entry!.client.removeChannel(entry!.channel);
    });
  };
}

export function activeNotificationRealtimeEntriesForTests() {
  return realtimeEntries.size;
}

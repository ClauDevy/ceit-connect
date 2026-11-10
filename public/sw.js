const FALLBACK_TITLE = "CEIT Connect";
const FALLBACK_BODY = "You have a new notification.";
const FIXED_TARGET = "/";

function validatedPayload(event) {
  try {
    const value = event.data ? event.data.json() : null;
    if (
      value &&
      typeof value === "object" &&
      typeof value.title === "string" &&
      value.title.length > 0 &&
      value.title.length <= 80 &&
      typeof value.body === "string" &&
      value.body.length > 0 &&
      value.body.length <= 240 &&
      typeof value.tag === "string" &&
      value.tag.length > 0 &&
      value.tag.length <= 80
    ) {
      return value;
    }
  } catch {
    // Invalid pushes must still display a generic notification, especially on iOS.
  }
  return { title: FALLBACK_TITLE, body: FALLBACK_BODY, tag: undefined };
}

self.addEventListener("push", (event) => {
  const payload = validatedPayload(event);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    icon: "/icons/icon-192.png",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      try {
        const focused = await existing.focus();
        if (focused) return focused;
      } catch {
        // An uncontrolled or closing client can reject focus; open a safe root window.
      }
    }
    return self.clients.openWindow(FIXED_TARGET);
  })());
});

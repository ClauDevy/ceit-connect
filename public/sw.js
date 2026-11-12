const FALLBACK_TITLE = "CEIT Connect";
const FALLBACK_BODY = "You have a new notification.";
const FIXED_TARGET = "/";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const TARGET_PATTERN = new RegExp(`^/tasks/${UUID}(?:#comment-${UUID})?$`, "i");

function validatedTargetPath(value) {
  return value === FIXED_TARGET || (typeof value === "string" && TARGET_PATTERN.test(value))
    ? value
    : FIXED_TARGET;
}

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
      value.tag.length <= 80 &&
      (value.targetPath === undefined || typeof value.targetPath === "string")
    ) {
      return { ...value, targetPath: validatedTargetPath(value.targetPath) };
    }
  } catch {
    // Invalid pushes must still display a generic notification, especially on iOS.
  }
  return { title: FALLBACK_TITLE, body: FALLBACK_BODY, tag: undefined, targetPath: FIXED_TARGET };
}

self.addEventListener("push", (event) => {
  const payload = validatedPayload(event);
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    icon: "/icons/icon-192.png",
    data: { targetPath: payload.targetPath },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const targetPath = validatedTargetPath(event.notification.data?.targetPath);
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      try {
        const navigated = await existing.navigate(targetPath);
        const focused = await (navigated ?? existing).focus();
        if (focused) return focused;
      } catch {
        // An uncontrolled or closing client can reject focus; open a safe root window.
      }
    }
    return self.clients.openWindow(targetPath);
  })());
});

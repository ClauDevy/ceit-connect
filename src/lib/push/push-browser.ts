export type PushPlatform = "android" | "desktop" | "ios" | "unknown"

type StandaloneNavigator = Navigator & { standalone?: boolean }

export function pushDeviceStorageKey(userId: string) {
  return `ceit-connect:push-subscription:${userId}`
}

export function detectPushPlatform(
  userAgent: string,
  maxTouchPoints = 0,
): PushPlatform {
  const touchMac = /Macintosh/i.test(userAgent) && maxTouchPoints > 1
  if (/iphone|ipad|ipod/i.test(userAgent) || touchMac) return "ios"
  if (/android/i.test(userAgent)) return "android"
  if (/windows|macintosh|linux|cros/i.test(userAgent)) return "desktop"
  return "unknown"
}

export function pushDeviceLabel(platform: PushPlatform) {
  if (platform === "ios") return "iPhone or iPad app"
  if (platform === "android") return "Android browser"
  if (platform === "desktop") return "Desktop browser"
  return "Browser device"
}

export function isInstalledApp() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as StandaloneNavigator).standalone === true
}

export function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=")
  const raw = window.atob(padded)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

export function bytesToBase64Url(value: ArrayBuffer) {
  const raw = String.fromCharCode(...new Uint8Array(value))
  return window.btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "ceit-sidebar-collapsed";
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const getServerSnapshot = () => false;

export function useSidebarCollapsed() {
  const collapsed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setCollapsed = useCallback((next: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Not persisted, but still applies for this session.
    }
    listeners.forEach((notify) => notify());
  }, []);

  const toggle = useCallback(() => setCollapsed(!getSnapshot()), [setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}

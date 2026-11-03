"use client";

import { useCallback, useSyncExternalStore } from "react";
import { THEME_STORAGE_KEY } from "@/lib/theme";
import { THEME_TRANSITION_MS } from "@/lib/motion";

export type Theme = "light" | "dark";

/** Where the circular reveal starts (viewport pixels), normally the centre of the toggle. */
export type ThemeOrigin = { x: number; y: number };

type TransitionDocument = Document & {
  startViewTransition?: (update: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
  };
};

// The <html> class is the single source of truth (set before paint by
// THEME_INIT_SCRIPT), so we subscribe to it instead of mirroring it in state.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

const getSnapshot = (): Theme =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";

const getServerSnapshot = (): Theme => "light";

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme, origin?: ThemeOrigin) => {
    const root = document.documentElement;
    const apply = () => {
      root.classList.toggle("dark", next === "dark");
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Storage can be blocked (private mode); the theme still applies for this visit.
      }
    };

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      apply();
      return;
    }

    const doc = document as TransitionDocument;
    if (typeof doc.startViewTransition === "function") {
      // The new theme grows out of the toggle as a circle until it covers the screen.
      const x = origin?.x ?? window.innerWidth / 2;
      const y = origin?.y ?? window.innerHeight / 2;
      const radius = Math.hypot(
        Math.max(x, window.innerWidth - x),
        Math.max(y, window.innerHeight - y),
      );
      root.setAttribute("data-theme-transition", "");
      try {
        const transition = doc.startViewTransition(apply);
        transition.ready
          .then(() => {
            root.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${radius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: THEME_TRANSITION_MS,
                easing: "cubic-bezier(0.65, 0, 0.35, 1)",
                pseudoElement: "::view-transition-new(root)",
              },
            );
          })
          .catch(() => undefined);
        transition.finished
          .catch(() => undefined)
          .finally(() => root.removeAttribute("data-theme-transition"));
      } catch {
        root.removeAttribute("data-theme-transition");
        apply();
      }
      return;
    }

    // Browsers without View Transitions: fade every colour instead of snapping.
    root.classList.add("theme-fade");
    apply();
    window.setTimeout(() => root.classList.remove("theme-fade"), THEME_TRANSITION_MS + 100);
  }, []);

  const toggleTheme = useCallback(
    (origin?: ThemeOrigin) => setTheme(getSnapshot() === "dark" ? "light" : "dark", origin),
    [setTheme],
  );

  return { theme, setTheme, toggleTheme };
}

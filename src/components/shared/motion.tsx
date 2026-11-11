"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type AnimationEvent,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  ENTRANCE_DURATION_MS,
  ENTRANCE_EASING,
  ENTRANCE_STAGGER_MS,
  LIST_ENTRANCE_ANIMATION_NAME,
  LIST_REVEAL_ANIMATION_NAME,
  PANEL_DURATION_MS,
  PANEL_REPLAY_ITEM_LIMIT,
  PROGRESS_VISIBILITY_THRESHOLD,
  claimReveal,
  capturedPrefixIsStable,
  createEntranceCapture,
  createRevealRegistry,
  decodeHashId,
  getEntranceClassName,
  settleEntranceCapture,
  type EntranceCapture,
} from "@/lib/motion";
import { cn } from "@/lib/utils";

type ObservedElement = HTMLElement & {
  dataset: DOMStringMap & { motionRevealId?: string };
};

function motionIsReduced() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
  );
}

export function useReducedMotionPreference() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return reduced;
}

/**
 * One visibility primitive powers list, progress, and future chart reveals.
 * It never hides before IntersectionObserver has delivered a real non-visible
 * entry. Missing/throwing observers and reduced motion therefore leave the
 * normal, final CSS state visible. Observed nodes are released after reveal.
 */
export function useVisibilityAnimation<T extends Element = HTMLElement>({
  className,
  threshold = PROGRESS_VISIBILITY_THRESHOLD,
  observeParent = false,
}: {
  className: string;
  threshold?: number;
  /**
   * Watch the node's parent instead of the node. Required for fills that sit inside an
   * overflow-hidden track: while waiting, the fill is collapsed or shifted, so the browser
   * reports it as never visible and it would otherwise never reveal.
   */
  observeParent?: boolean;
}) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const nodeRef = useRef<T | null>(null);
  const targetRef = useRef<Element | null>(null);
  const revealedRef = useRef(false);

  const reveal = useCallback(() => {
    const node = nodeRef.current;
    if (!node || revealedRef.current) return;
    revealedRef.current = true;
    node.removeAttribute("data-motion-pending");
    node.classList.add(className);
    observerRef.current?.unobserve(targetRef.current ?? node);
  }, [className]);

  const ref = useCallback(
    (node: T | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      nodeRef.current = node;
      targetRef.current = null;
      if (!node || revealedRef.current || motionIsReduced()) return;
      if (typeof IntersectionObserver === "undefined") return;

      const target = observeParent ? (node.parentElement ?? node) : node;
      targetRef.current = target;
      try {
        observerRef.current = new IntersectionObserver(
          ([entry]) => {
            if (!entry) return;
            if (entry.isIntersecting && entry.intersectionRatio >= threshold) {
              reveal();
            } else {
              // This is deliberately delayed until the observer proves it is
              // working, preventing an SSR/hydration hidden flash.
              node.setAttribute("data-motion-pending", "");
            }
          },
          { threshold: [0, threshold] },
        );
        observerRef.current.observe(target);
      } catch {
        observerRef.current?.disconnect();
        observerRef.current = null;
        node.removeAttribute("data-motion-pending");
      }
    },
    [reveal, threshold, observeParent],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);
  return ref;
}

export function ChartBarGrow({
  axis = "y",
  observeParent = false,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { axis?: "x" | "y"; observeParent?: boolean }) {
  const motionClass =
    axis === "x" ? "motion-chart-grow-x" : "motion-chart-grow-y";
  const visibilityRef = useVisibilityAnimation<HTMLDivElement>({
    className: motionClass,
    observeParent,
  });
  return (
    <div
      {...props}
      ref={visibilityRef}
      data-motion-axis={axis}
      className={cn("motion-chart-bar", className)}
    />
  );
}

export function useListReveal<T>({
  initialItems,
  items,
  settled,
  error = null,
  isPlaceholderData = false,
  waitForSuccessfulData = false,
  getId,
}: {
  initialItems?: readonly T[];
  items: readonly T[];
  settled: boolean;
  error?: unknown;
  isPlaceholderData?: boolean;
  waitForSuccessfulData?: boolean;
  getId: (item: T) => string;
}) {
  const [storedCapture, setStoredCapture] = useState<EntranceCapture>(() =>
    createEntranceCapture({ initialItems, getId, waitForSuccessfulData }),
  );
  const entranceCapture = settleEntranceCapture({
    capture: storedCapture,
    items,
    settled,
    error,
    isPlaceholderData,
    getId,
  });
  if (entranceCapture !== storedCapture) setStoredCapture(entranceCapture);
  const registry = useRef(createRevealRegistry());
  const observer = useRef<IntersectionObserver | null>(null);
  const nodes = useRef(new Map<string, ObservedElement>());
  const initiallyBelowFold = useRef(new Set<string>());

  const finishAnimation = useCallback(function handleAnimationEnd(
    event: Event,
  ) {
    if (!(event instanceof AnimationEvent)) return;
    if (
      event.target !== event.currentTarget ||
      (event.animationName !== LIST_ENTRANCE_ANIMATION_NAME &&
        event.animationName !== LIST_REVEAL_ANIMATION_NAME)
    )
      return;
    const node = event.currentTarget as ObservedElement;
    node.classList.remove(
      "motion-list-item-enter",
      "motion-list-item-reveal",
      ...Array.from({ length: 8 }, (_, index) => `motion-list-delay-${index}`),
    );
    node.removeEventListener("animationend", handleAnimationEnd);
  }, []);

  const revealNode = useCallback(
    (id: string, node: ObservedElement, animate = true) => {
      if (!claimReveal(registry.current, id)) {
        node.removeAttribute("data-motion-pending");
        observer.current?.unobserve(node);
        return;
      }

      node.removeAttribute("data-motion-pending");
      if (!animate) {
        observer.current?.unobserve(node);
        return;
      }
      const initialClass = getEntranceClassName(entranceCapture, id);
      if (initialClass && !initiallyBelowFold.current.has(id)) {
        node.classList.add(...initialClass.split(" "));
      } else if (
        entranceCapture.initialIds.has(id) &&
        !initiallyBelowFold.current.has(id)
      ) {
        // Items outside the first-20 entrance cap that were already visible on
        // the initial render stay final-state visible. Initial rows that were
        // genuinely below the fold may still reveal once when scrolled to.
      } else {
        node.classList.add("motion-list-item-reveal");
      }
      node.addEventListener("animationend", finishAnimation);
      observer.current?.unobserve(node);
    },
    [entranceCapture, finishAnimation],
  );

  useLayoutEffect(() => {
    if (motionIsReduced() || typeof IntersectionObserver === "undefined")
      return;
    try {
      observer.current = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const node = entry.target as ObservedElement;
          const id = node.dataset.motionRevealId;
          if (!id) continue;
          if (entry.isIntersecting) revealNode(id, node);
          else {
            initiallyBelowFold.current.add(id);
            node.setAttribute("data-motion-pending", "");
          }
        }
      });
      for (const node of nodes.current.values()) observer.current.observe(node);
    } catch {
      observer.current?.disconnect();
      observer.current = null;
      for (const node of nodes.current.values())
        node.removeAttribute("data-motion-pending");
    }
    return () => observer.current?.disconnect();
  }, [revealNode]);

  useEffect(() => {
    function revealEventTarget(event: Event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const node = target.closest<ObservedElement>("[data-motion-reveal-id]");
      const id = node?.dataset.motionRevealId;
      if (node && id) revealNode(id, node, false);
    }
    function revealHashTarget() {
      const id = decodeHashId(window.location.hash);
      if (id === null) return;
      const target = document.getElementById(id);
      target?.dispatchEvent(new Event("beforematch", { bubbles: true }));
    }
    document.addEventListener("focusin", revealEventTarget, true);
    document.addEventListener("beforematch", revealEventTarget, true);
    window.addEventListener("hashchange", revealHashTarget);
    revealHashTarget();
    return () => {
      document.removeEventListener("focusin", revealEventTarget, true);
      document.removeEventListener("beforematch", revealEventTarget, true);
      window.removeEventListener("hashchange", revealHashTarget);
    };
  }, [revealNode]);

  const getRevealProps = useCallback(
    (id: string) => ({
      "data-motion-reveal-id": id,
      ref: (node: HTMLElement | null) => {
        const previous = nodes.current.get(id);
        if (previous && previous !== node)
          observer.current?.unobserve(previous);
        if (!node) {
          nodes.current.delete(id);
          return;
        }
        nodes.current.set(id, node as ObservedElement);
        if (registry.current.revealedIds.has(id)) return;
        try {
          observer.current?.observe(node);
        } catch {
          node.removeAttribute("data-motion-pending");
        }
      },
    }),
    [],
  );

  return { getRevealProps };
}

export function TabPanel({
  motionKey,
  opacityOnly = false,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  motionKey: number;
  opacityOnly?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // Panels that are hidden/shown (Workspace tabs) replay through plain CSS: a panel coming back
  // from display:none restarts its items' animation by itself, which is exactly the first-visit
  // stacking. Panels that stay on screen (event board phases) are restarted from script below.
  const cssReplay = props.hidden !== undefined;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (cssReplay || !panel || motionKey <= 0) return;
    if (motionIsReduced() || typeof panel.animate !== "function") return;

    const items = Array.from(
      panel.querySelectorAll<HTMLElement>(
        "[data-motion-reveal-id], [data-motion-replay]",
      ),
    )
      .filter((node) => !node.hasAttribute("data-motion-pending"))
      .slice(0, PANEL_REPLAY_ITEM_LIMIT);

    panel.animate(
      items.length === 0 && !opacityOnly
        ? [
            { opacity: 0, transform: "translateY(14px)" },
            { opacity: 1, transform: "translateY(0)" },
          ]
        : [{ opacity: 0 }, { opacity: 1 }],
      { duration: PANEL_DURATION_MS, easing: ENTRANCE_EASING },
    );
    items.forEach((node, index) => {
      const keyframes = node.hasAttribute("data-motion-sortable")
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(16px)" },
            { opacity: 1, transform: "translateY(0)" },
          ];
      node.animate(
        keyframes,
        {
          duration: ENTRANCE_DURATION_MS,
          delay: index * ENTRANCE_STAGGER_MS,
          easing: ENTRANCE_EASING,
          fill: "backwards",
        },
      );
    });
  }, [motionKey, opacityOnly, cssReplay]);

  return (
    <div
      ref={panelRef}
      className={cn(cssReplay && motionKey > 0 && "motion-tab-replay", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function SectionEnter({
  as: Tag = "div",
  index = 0,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { index?: number; as?: "div" | "section" }) {
  const style = {
    ...props.style,
    "--motion-section-delay": `${Math.min(Math.max(index, 0), 3) * 80}ms`,
  } as CSSProperties;
  return (
    <Tag
      {...props}
      className={cn("motion-section-enter", className)}
      style={style}
    >
      {children}
    </Tag>
  );
}

export function Collapse({
  open,
  className,
  children,
}: {
  open: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn("motion-collapse", className)}
      data-open={open ? "true" : "false"}
      aria-hidden={!open}
      inert={!open ? true : undefined}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

export function MotionPresence({
  open,
  children,
  className,
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
}) {
  const snapshot = useRef(children);
  // The snapshot intentionally preserves the last committed protected content
  // only for its inert closing frame; it is never used while the panel is open.
  // eslint-disable-next-line react-hooks/refs
  if (open) snapshot.current = children;
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);

  useLayoutEffect(() => {
    if (open) {
      // Presence state must synchronize before paint so quick reopen cannot
      // expose a stale inert frame.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPresent(true);
      setClosing(false);
      return;
    }
    if (!present) return;
    if (motionIsReduced()) {
      setPresent(false);
      setClosing(false);
    } else {
      setClosing(true);
    }
  }, [open, present]);

  if (!present && !open) return null;

  return (
    <div
      className={cn("motion-presence", className)}
      data-closing={closing ? "true" : "false"}
      aria-hidden={closing || undefined}
      inert={closing ? true : undefined}
      onTransitionEnd={(event) => {
        if (
          event.target === event.currentTarget &&
          event.propertyName === "opacity" &&
          closing &&
          !open
        ) {
          setPresent(false);
          setClosing(false);
        }
      }}
    >
      {/* eslint-disable-next-line react-hooks/refs */}
      {open ? children : snapshot.current}
    </div>
  );
}

export function RouteEntrance({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div key={pathname} className="motion-route-enter">
      {children}
    </div>
  );
}

export function useInitialListEntrance<T>({
  initialItems,
  items,
  settled,
  error = null,
  isPlaceholderData = false,
  waitForSuccessfulData = false,
  getId,
}: {
  initialItems?: readonly T[];
  items: readonly T[];
  settled: boolean;
  error?: unknown;
  isPlaceholderData?: boolean;
  waitForSuccessfulData?: boolean;
  getId: (item: T) => string;
}) {
  const [storedCapture, setStoredCapture] = useState<EntranceCapture>(() =>
    createEntranceCapture({ initialItems, getId, waitForSuccessfulData }),
  );

  const settledCapture = settleEntranceCapture({
    capture: storedCapture,
    items,
    settled,
    error,
    isPlaceholderData,
    getId,
  });

  const activeCapture =
    settledCapture.phase === "playing" &&
    !capturedPrefixIsStable(settledCapture, items, getId)
      ? { ...settledCapture, phase: "done" as const }
      : settledCapture;

  if (activeCapture !== storedCapture) {
    setStoredCapture(activeCapture);
  }

  const onAnimationEnd = useCallback((event: AnimationEvent<HTMLElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.animationName !== LIST_ENTRANCE_ANIMATION_NAME
    ) {
      return;
    }

    const entranceId = event.currentTarget.dataset.motionEntranceId;
    setStoredCapture((current) =>
      current.phase === "playing" && entranceId === [...current.ids].at(-1)
        ? { ...current, phase: "done" }
        : current,
    );
  }, []);

  return {
    isEntranceItem: (id: string) =>
      activeCapture.phase === "playing" && activeCapture.ids.has(id),
    getEntranceClassName: (id: string) =>
      getEntranceClassName(activeCapture, id),
    onAnimationEnd,
  };
}

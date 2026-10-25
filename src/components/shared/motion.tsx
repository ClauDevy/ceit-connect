"use client";

import {
  useCallback,
  useState,
  type AnimationEvent,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import {
  LIST_ENTRANCE_ANIMATION_NAME,
  capturedPrefixIsStable,
  createEntranceCapture,
  getEntranceClassName,
  settleEntranceCapture,
  type EntranceCapture,
} from "@/lib/motion";

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
      ? { phase: "done" as const, ids: settledCapture.ids }
      : settledCapture;

  if (activeCapture !== storedCapture) {
    setStoredCapture(activeCapture);
  }

  const onAnimationEnd = useCallback(
    (event: AnimationEvent<HTMLElement>) => {
      if (
        event.target !== event.currentTarget ||
        event.animationName !== LIST_ENTRANCE_ANIMATION_NAME
      ) {
        return;
      }

      const entranceId = event.currentTarget.dataset.motionEntranceId;
      setStoredCapture((current) =>
        current.phase === "playing" &&
        entranceId === [...current.ids].at(-1)
          ? { phase: "done", ids: current.ids }
          : current,
      );
    },
    [],
  );

  return {
    isEntranceItem: (id: string) =>
      activeCapture.phase === "playing" && activeCapture.ids.has(id),
    getEntranceClassName: (id: string) =>
      getEntranceClassName(activeCapture, id),
    onAnimationEnd,
  };
}

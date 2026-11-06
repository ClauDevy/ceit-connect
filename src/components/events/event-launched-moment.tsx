"use client";

import { useEffect, useState } from "react";
import { Mascot } from "@/components/ui/mascot";

/**
 * Success moment after Launch Event. The tiger sits on the page itself (never in a
 * card) with one friendly line. The `?launched=1` marker is removed from the address
 * as soon as this shows, so a reload or coming back to Home does not show it again;
 * it stays on screen until "Dismiss" is pressed.
 */
export function EventLaunchedMoment() {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Replace the address without navigating, so this stays visible but is one-time.
    window.history.replaceState(null, "", "/home");
  }, []);

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="motion-success-enter mb-6 flex flex-col items-center gap-1 text-center"
    >
      <Mascot pose="celebrating" size={104} />
      <p className="font-display text-lg font-semibold">Event launched!</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Your team can see it now. Time to get the tasks moving.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Dismiss
      </button>
    </div>
  );
}

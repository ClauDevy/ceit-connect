import Link from "next/link";
import { Mascot } from "@/components/ui/mascot";

/**
 * Success moment after Launch Event. The tiger sits on the page itself (never in a
 * card) with one friendly line; "Dismiss" just reloads Home without the marker.
 */
export function EventLaunchedMoment() {
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
      <Link
        href="/home"
        className="mt-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Dismiss
      </Link>
    </div>
  );
}

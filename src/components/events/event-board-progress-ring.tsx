const RADIUS = 27;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function getProgressRingDashOffset(percentage: number) {
  const boundedPercentage = Math.min(100, Math.max(0, percentage));
  return CIRCUMFERENCE * (1 - boundedPercentage / 100);
}

export function EventBoardProgressRing({ percentage }: { percentage: number }) {
  const boundedPercentage = Math.min(100, Math.max(0, percentage));

  return (
    <div
      className="relative size-16 shrink-0"
      aria-hidden="true"
      data-progress={boundedPercentage}
    >
      <svg viewBox="0 0 64 64" className="size-16 -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          className="stroke-muted"
          strokeWidth="6"
        />
        {boundedPercentage > 0 ? (
          <circle
            cx="32"
            cy="32"
            r={RADIUS}
            fill="none"
            className="motion-progress-ring stroke-primary"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={getProgressRingDashOffset(boundedPercentage)}
            style={{
              "--motion-ring-empty-offset": CIRCUMFERENCE,
            } as CSSProperties}
          />
        ) : null}
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-bold text-foreground">
        {boundedPercentage}%
      </span>
    </div>
  );
}
import type { CSSProperties } from "react";

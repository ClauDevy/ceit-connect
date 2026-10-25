import type { ComponentProps } from "react";

export type PriorityLevel = "Low" | "Medium" | "High" | "Critical";

const priorityStyles: Record<PriorityLevel, string> = {
  Critical:
    "border-priority-critical-border bg-priority-critical-soft text-priority-critical",
  High: "border-priority-high-border bg-priority-high-soft text-priority-high",
  Medium:
    "border-priority-medium-border bg-priority-medium-soft text-priority-medium",
  Low: "border-priority-low-border bg-priority-low-soft text-priority-low",
};

const priorityAccentStyles: Record<PriorityLevel, string> = {
  Critical: "border-l-priority-critical-border",
  High: "border-l-priority-high-border",
  Medium: "border-l-priority-medium-border",
  Low: "border-l-priority-low-border",
};

const priorityDotStyles: Record<PriorityLevel, string> = {
  Critical: "bg-priority-critical",
  High: "bg-priority-high",
  Medium: "bg-priority-medium",
  Low: "bg-priority-low",
};

export function getPriorityAccentClass(priority: PriorityLevel) {
  return priorityAccentStyles[priority];
}

export function getPriorityDotClass(priority: PriorityLevel) {
  return priorityDotStyles[priority];
}

export function PriorityBadge({
  priority,
  suffix,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  priority: PriorityLevel;
  suffix?: string;
}) {
  return (
    <span
      data-priority={priority}
      className={[
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        priorityStyles[priority],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      <span
        className={`size-1.5 rounded-full ${getPriorityDotClass(priority)}`}
        aria-hidden="true"
      />
      {priority}
      {suffix ? ` ${suffix}` : null}
    </span>
  );
}

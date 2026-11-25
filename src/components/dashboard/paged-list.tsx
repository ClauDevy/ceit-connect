"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shows the first `pageSize` rows and only adds a "Show more" control once the list is
 * longer than one page. Short lists look exactly like a plain list (no extra chrome); a
 * long list (many members with zero tasks, 12 committees) stays compact until asked.
 */
export function PagedList<T>({
  items,
  pageSize = 5,
  getKey,
  renderItem,
  as = "div",
  className,
  label,
}: {
  items: readonly T[];
  pageSize?: number;
  getKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
  as?: "div" | "ul";
  className?: string;
  /** Plural noun for the control, e.g. "members". */
  label: string;
}) {
  const [visible, setVisible] = useState(pageSize);
  const shown = items.slice(0, visible);
  const remaining = items.length - shown.length;
  const Wrapper = as;

  return (
    <div className="space-y-2">
      <Wrapper className={cn("motion-stagger", className)}>
        {shown.map((item) => (
          <PagedItem key={getKey(item)} as={as}>
            {renderItem(item)}
          </PagedItem>
        ))}
      </Wrapper>
      {items.length > pageSize ? (
        <div className="flex items-center justify-between gap-2 pt-1">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Showing {shown.length} of {items.length} {label}
          </p>
          {remaining > 0 ? (
            <button
              type="button"
              onClick={() => setVisible((current) => current + pageSize)}
              className={controlClass}
            >
              Show {Math.min(pageSize, remaining)} more
              <ChevronDown aria-hidden className="size-3.5" />
            </button>
          ) : (
            <button type="button" onClick={() => setVisible(pageSize)} className={controlClass}>
              Show less
              <ChevronUp aria-hidden className="size-3.5" />
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

const controlClass = cn(
  "inline-flex min-h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-primary outline-none",
  "hover:bg-primary/10 focus-visible:ring-3 focus-visible:ring-ring/50",
);

// A <ul> needs <li> children; a <div> list takes the row as-is. Rows keep their own markup.
function PagedItem({ as, children }: { as: "div" | "ul"; children: ReactNode }) {
  return as === "ul" ? <li>{children}</li> : <>{children}</>;
}

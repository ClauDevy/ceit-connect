import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Layout primitives for the task page. The old page put every block in its own bordered card
 * (ten of them on a phone). These give the page two quieter levels instead:
 *
 * - `TaskSection`: a heading and content that sit on the page itself, no box.
 * - `TaskPanel` + `PanelBlock`: ONE bordered surface for the side details, with soft dividers
 *   between blocks.
 * - `TaskCallout`: the single tinted box for "someone needs to act" items.
 */

export function TaskSection({
  title,
  icon,
  description,
  action,
  children,
  className,
  headingId,
}: {
  title: ReactNode;
  icon?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headingId?: string;
}) {
  return (
    <section className={cn("space-y-3", className)} aria-labelledby={headingId}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={headingId}
            className="flex items-center gap-2 font-display text-lg font-semibold tracking-tight"
          >
            {icon ? (
              <span className="text-muted-foreground [&_svg]:size-5" aria-hidden>
                {icon}
              </span>
            ) : null}
            {title}
          </h2>
          {description ? (
            <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function TaskPanel({
  children,
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "overflow-hidden rounded-2xl border bg-card text-card-foreground [&>*+*]:border-t [&>*+*]:border-border/70",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PanelBlock({
  title,
  icon,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3 px-4 py-4 sm:px-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
          {icon ? (
            <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
              {icon}
            </span>
          ) : null}
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Warm tinted strip for items that need someone to act (leave requests, backup requests). */
export function TaskCallout({
  title,
  icon,
  aside,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-2xl border border-primary/30 bg-primary/[0.06] p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold">
          {icon ? (
            <span className="text-primary [&_svg]:size-4" aria-hidden>
              {icon}
            </span>
          ) : null}
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

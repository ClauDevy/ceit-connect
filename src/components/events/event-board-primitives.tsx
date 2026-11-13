"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";
import { Check } from "lucide-react";
import { getPriorityDotClass } from "@/components/shared/priority-badge";
import { Button } from "@/components/ui/button";
import {
  BOARD_PRIORITIES,
  type BoardPriority,
  type BoardStatus,
} from "@/lib/events/board";
import { cn } from "@/lib/utils";

export function PriorityChoices({
  selected,
  onToggle,
}: {
  selected: Set<BoardPriority>;
  onToggle: (priority: BoardPriority) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 sm:block sm:space-y-3">
      <p className="shrink-0 font-display text-sm font-semibold">
        Filter by priority
      </p>
      <div className="grid min-h-0 grid-cols-2 gap-2 overflow-y-auto overscroll-contain sm:overflow-visible">
        {BOARD_PRIORITIES.map((priority) => {
          const active = selected.has(priority);
          return (
            <Button
              key={priority}
              type="button"
              variant="outline"
              className={cn(
                "h-11 justify-between",
                active && "border-primary bg-primary/10 text-primary",
              )}
              aria-pressed={active}
              onClick={() => onToggle(priority)}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`size-2 rounded-full ${getPriorityDotClass(priority)}`}
                  aria-hidden="true"
                />
                {priority}
              </span>
              {active ? <Check aria-hidden /> : null}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

export function BoardLaneDropZone({
  id,
  status,
  disabled,
  collapsed = false,
  children,
}: {
  id?: string;
  status: BoardStatus;
  disabled: boolean;
  collapsed?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `lane:${status}`,
    disabled,
    data: { type: "lane", status, collapsed },
  });

  return (
    <div
      id={id}
      ref={setNodeRef}
      className={cn(
        "min-h-20 space-y-3 rounded-xl transition-colors duration-300 motion-reduce:transition-none",
        isOver && !disabled && "bg-primary/5 ring-2 ring-primary/30",
      )}
    >
      {children}
    </div>
  );
}

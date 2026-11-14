import Link from "next/link";
import { Check } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { InitialEvent } from "@/components/events/event-form-types";

type EventFormSummaryProps = {
  initialEvent?: InitialEvent;
  name: string;
  datesSet: boolean;
  datesOutOfOrder: boolean;
  startDate: string;
  endDate: string;
  phaseCount: number;
  taskCount: number;
  nameSet: boolean;
  hasTasks: boolean;
  error: string;
  status: "idle" | "saving";
  readyToLaunch: boolean;
  onSave: (launch: boolean) => void;
};

export function EventFormSummary({
  initialEvent,
  name,
  datesSet,
  datesOutOfOrder,
  startDate,
  endDate,
  phaseCount,
  taskCount,
  nameSet,
  hasTasks,
  error,
  status,
  readyToLaunch,
  onSave,
}: EventFormSummaryProps) {
  return (
    <Card className="h-fit overflow-hidden lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7.5rem)] lg:overflow-y-auto">
      <CardHeader className="border-b bg-gradient-to-r from-primary/10 via-muted/30 to-card pb-4 sm:pb-4">
        <p className="text-[11px] font-bold tracking-wide text-accent-foreground uppercase">
          Event summary
        </p>
        <CardTitle>{name.trim() || "Untitled Event"}</CardTitle>
        <p className="text-xs text-muted-foreground">
          {datesSet ? `${startDate} – ${endDate}` : "Dates not set"}
        </p>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-2 border-y py-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Phases</span>
            <span className="font-semibold">{phaseCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total tasks</span>
            <span className="font-semibold">{taskCount}</span>
          </div>
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground">
          <SummaryCheck done={nameSet}>Event name set</SummaryCheck>
          <SummaryCheck done={datesSet && !datesOutOfOrder}>
            Valid start and end dates
          </SummaryCheck>
          <SummaryCheck done={hasTasks}>
            At least one task added
          </SummaryCheck>
        </div>

        {error && <InlineAlert>{error}</InlineAlert>}

        <Button
          type="button"
          variant={initialEvent?.status === "Active" ? "default" : "outline"}
          size="lg"
          className={initialEvent?.status === "Active" ? "order-1" : "order-2"}
          disabled={status === "saving"}
          onClick={() => onSave(false)}
        >
          {status === "saving"
            ? "Saving…"
            : initialEvent
              ? "Save Changes"
              : "Save Draft"}
        </Button>
        {(!initialEvent || initialEvent.status === "Draft") && (
          <Button
            type="button"
            size="lg"
            className="order-1"
            disabled={status === "saving" || !readyToLaunch}
            onClick={() => onSave(true)}
          >
            {status === "saving" ? "Saving…" : "Launch Event"}
          </Button>
        )}
        <Link
          href="/home"
          className={buttonVariants({
            variant: "outline",
            size: "lg",
            className: "order-3 w-full",
          })}
        >
          Cancel
        </Link>
        {initialEvent ? null : (
          <p className="order-4 text-xs text-muted-foreground">
            Launch requires valid dates and at least one task. Drafts may be saved without tasks.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryCheck({
  done,
  children,
}: {
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        aria-hidden
        className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
          done
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border"
        }`}
      >
        {done ? <Check className="size-2.5" /> : null}
      </span>
      <span>{children}</span>
    </div>
  );
}

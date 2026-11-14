import { CalendarDays, ChevronRight } from "lucide-react";
import { BannerUploader } from "@/components/events/banner-uploader";
import { MotionPresence, SectionEnter, TabPanel } from "@/components/shared/motion";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { InlineAlert } from "@/components/ui/inline-alert";
import { Input } from "@/components/ui/input";
import { friendlyDate } from "@/components/events/event-form-helpers";
import type { InitialEvent } from "@/components/events/event-form-types";

type EventFormFundamentalsProps = {
  tabMotionKey: number;
  initialEvent?: InitialEvent;
  name: string;
  bannerUrl: string | null;
  eventVersion: string;
  pendingBanner: File | null;
  startDate: string;
  endDate: string;
  datesOutOfOrder: boolean;
  tasksAfterEventEnd: { id: string; title: string; fields: string[] }[];
  description: string;
  onPendingBannerChange: (file: File | null) => void;
  onBannerSaved: (bannerUrl: string | null, updatedAt: string) => void;
  onNameChange: (value: string) => void;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onContinue: () => void;
};

export function EventFormFundamentals({
  tabMotionKey,
  initialEvent,
  name,
  bannerUrl,
  eventVersion,
  pendingBanner,
  startDate,
  endDate,
  datesOutOfOrder,
  tasksAfterEventEnd,
  description,
  onPendingBannerChange,
  onBannerSaved,
  onNameChange,
  onStartDateChange,
  onEndDateChange,
  onDescriptionChange,
  onContinue,
}: EventFormFundamentalsProps) {
  return (
    <TabPanel
      motionKey={tabMotionKey}
      id="event-fundamentals-panel"
      className="grid gap-5"
    >
      <SectionEnter index={0} className="flex items-start gap-3 rounded-xl border bg-gradient-to-r from-primary/10 via-muted/30 to-card p-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <CalendarDays aria-hidden className="size-5" />
        </span>
        <div>
          <h2 className="font-display font-semibold">Event fundamentals</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Set the event identity, schedule, and banner.
          </p>
        </div>
      </SectionEnter>
      <SectionEnter index={1} className="grid gap-2">
        <p className="text-sm font-semibold">Event banner</p>
        <BannerUploader
          eventName={name}
          eventId={initialEvent?.id}
          currentBannerUrl={bannerUrl}
          expectedUpdatedAt={initialEvent ? eventVersion : undefined}
          pendingFile={pendingBanner}
          onPendingFileChange={onPendingBannerChange}
          onSaved={onBannerSaved}
        />
      </SectionEnter>

      <FormField label="Event name">
        {(control) => (
          <Input
            {...control}
            required
            maxLength={150}
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="e.g. Freshmen Orientation"
          />
        )}
      </FormField>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Start date">
          {(control) => (
            <Input
              {...control}
              type="date"
              value={startDate}
              onChange={(event) => onStartDateChange(event.target.value)}
            />
          )}
        </FormField>
        <FormField
          label={
            initialEvent?.status === "Active"
              ? "End date (required for Active events)"
              : "End date"
          }
          error={
            datesOutOfOrder
              ? "End date must be on or after the start date."
              : null
          }
        >
          {(control) => (
            <Input
              {...control}
              type="date"
              min={startDate || undefined}
              aria-invalid={datesOutOfOrder}
              value={endDate}
              onChange={(event) => onEndDateChange(event.target.value)}
              required={
                initialEvent?.status === "Active" &&
                Boolean(initialEvent.endDate)
              }
            />
          )}
        </FormField>
        {initialEvent?.status === "Active" && !initialEvent.endDate ? (
          <p className="text-xs text-muted-foreground sm:col-start-2">
            This legacy Active event can still be saved without an end date, or
            you can add one now.
          </p>
        ) : null}
      </div>

      <MotionPresence open={tasksAfterEventEnd.length > 0}>
        {tasksAfterEventEnd.length > 0 ? <InlineAlert>
          <div className="grid gap-1">
            <p>
              The event cannot end on {friendlyDate(endDate)} because these
              tasks are scheduled later:
            </p>
            <ul className="list-disc pl-5">
              {tasksAfterEventEnd.map((task) => (
                <li key={task.id}>
                  {task.title} — {task.fields.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        </InlineAlert> : null}
      </MotionPresence>

      <FormField
        label="Description"
        action={
          <span className="text-xs text-muted-foreground">
            {description.length}/300
          </span>
        }
      >
        {(control) => (
          <textarea
            {...control}
            rows={4}
            maxLength={300}
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="What is this event, and why does it matter?"
            className="w-full resize-none rounded-xl border border-input bg-card px-3.5 py-2.5 text-sm outline-none transition-[color,box-shadow,border-color] duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 motion-reduce:transition-none dark:bg-input/30"
          />
        )}
      </FormField>

      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-10 -mx-1 bg-card/95 px-1 py-2 backdrop-blur md:static md:mx-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
        <Button type="button" className="w-full md:w-fit" onClick={onContinue}>
          Continue to Task Setup
          <ChevronRight />
        </Button>
      </div>
    </TabPanel>
  );
}

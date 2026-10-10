"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function CreateEventForm() {
  const router = useRouter();
  const [tab, setTab] = useState<"fundamentals" | "tasks">("fundamentals");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [status, setStatus] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState("");

  const nameSet = name.trim().length > 0;
  const startSet = startDate.length > 0;
  const datesSet = startSet && endDate.length > 0;
  // ISO yyyy-mm-dd strings sort the same way as the dates they represent,
  // so a plain string comparison is enough here.
  const datesOutOfOrder = datesSet && endDate < startDate;
  const readyToLaunch = nameSet && datesSet && !datesOutOfOrder;

  async function handleSave(launch: boolean) {
    if (!nameSet) {
      setError("Give the event a name first.");
      return;
    }
    // start_date is NOT NULL in the database, so even a draft needs one.
    if (!startSet) {
      setError("Pick a start date first — even drafts need one.");
      return;
    }
    if (datesOutOfOrder) {
      setError("The end date can't be before the start date.");
      return;
    }
    if (launch && !datesSet) {
      setError("Set both a start and end date before launching.");
      return;
    }

    setStatus("saving");
    setError("");

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setError("You're not signed in.");
        setStatus("idle");
        return;
      }

      const { error: insertError } = await supabase.from("events").insert({
        name: name.trim(),
        description: description.trim() || null,
        start_date: startDate,
        end_date: endDate || null,
        status: launch ? "Active" : "Draft",
        created_by: user.id,
      });

      if (insertError) {
        setError(insertError.message);
        setStatus("idle");
        return;
      }

      router.push("/home");
    } catch {
      setError("Network error, please try again.");
      setStatus("idle");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          Create Event
        </h1>
        <p className="text-sm text-muted-foreground">
          Set the basics now — tasks can be added in a follow-up update.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-2xl border bg-card p-6">
          <div className="mb-5 flex gap-1 border-b">
            <button
              onClick={() => setTab("fundamentals")}
              className={`px-3 py-2 text-sm font-semibold ${
                tab === "fundamentals"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground"
              }`}
            >
              Fundamentals
            </button>
            <button
              onClick={() => setTab("tasks")}
              className={`px-3 py-2 text-sm font-semibold ${
                tab === "tasks"
                  ? "border-b-2 border-primary text-primary"
                  : "text-muted-foreground"
              }`}
            >
              Tasks
            </button>
          </div>

          {tab === "fundamentals" ? (
            <div className="flex flex-col gap-4">
              <div className="flex aspect-[21/9] items-center justify-center rounded-xl border-2 border-dashed bg-muted/40 text-center text-sm text-muted-foreground">
                Banner upload coming in a follow-up update
              </div>

              <div>
                <label
                  htmlFor="event-name"
                  className="mb-1.5 block text-sm font-semibold"
                >
                  Event name
                </label>
                <input
                  id="event-name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Freshmen Orientation"
                  className="w-full rounded-xl border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="event-start-date"
                    className="mb-1.5 block text-sm font-semibold"
                  >
                    Start date
                  </label>
                  <input
                    id="event-start-date"
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                </div>
                <div>
                  <label
                    htmlFor="event-end-date"
                    className="mb-1.5 block text-sm font-semibold"
                  >
                    End date
                  </label>
                  <input
                    id="event-end-date"
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    aria-invalid={datesOutOfOrder}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                  />
                </div>
                {datesOutOfOrder && (
                  <p
                    role="alert"
                    className="col-span-2 -mt-2 text-xs text-destructive"
                  >
                    End date must be on or after the start date.
                  </p>
                )}
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label
                    htmlFor="event-description"
                    className="text-sm font-semibold"
                  >
                    Description
                  </label>
                  <span className="text-xs text-muted-foreground">
                    {description.length}/300
                  </span>
                </div>
                <textarea
                  id="event-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 300))}
                  rows={4}
                  placeholder="What is this event, and why does it matter?"
                  className="w-full resize-none rounded-xl border bg-background px-3.5 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
                />
              </div>
            </div>
          ) : (
            <p className="rounded-xl border-2 border-dashed p-8 text-center text-sm text-muted-foreground">
              Task Setup is coming in a follow-up update — for now, save the
              event&apos;s basics and tasks can be added afterward.
            </p>
          )}
        </div>

        <div className="h-fit rounded-2xl border bg-card p-5">
          <p className="font-display text-base font-semibold">
            {name.trim() || "Untitled Event"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {datesSet ? `${startDate} – ${endDate}` : "Dates not set"}
          </p>

          <div className="mt-4 flex flex-col gap-2 border-t pt-4">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                  nameSet ? "border-primary bg-primary" : "border-border"
                }`}
              />
              <span className="text-muted-foreground">Event name set</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`h-4 w-4 shrink-0 rounded-full border-2 ${
                  datesSet && !datesOutOfOrder
                    ? "border-primary bg-primary"
                    : "border-border"
                }`}
              />
              <span className="text-muted-foreground">
                Valid start &amp; end dates
              </span>
            </div>
          </div>

          {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

          <button
            onClick={() => handleSave(false)}
            disabled={status === "saving"}
            className="mt-4 w-full rounded-xl border py-2.5 text-sm font-semibold hover:bg-secondary disabled:opacity-50"
          >
            Save Draft
          </button>
          <button
            onClick={() => handleSave(true)}
            disabled={status === "saving" || !readyToLaunch}
            className="mt-2.5 w-full rounded-xl bg-foreground py-2.5 text-sm font-semibold text-background hover:bg-accent-foreground disabled:cursor-not-allowed disabled:opacity-40"
          >
            {status === "saving" ? "Saving..." : "Launch Event"}
          </button>
        </div>
      </div>
    </div>
  );
}

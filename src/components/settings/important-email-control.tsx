"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { InlineAlert } from "@/components/ui/inline-alert";

type ImportantEmailControlProps = {
  available: boolean;
  initialEnabled: boolean;
};

export function ImportantEmailControl({
  available,
  initialEnabled,
}: ImportantEmailControlProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  if (!available) {
    return (
      <InlineAlert variant="info">
        Email preferences are temporarily unavailable. Nothing was changed.
      </InlineAlert>
    );
  }

  async function updatePreference(next: boolean) {
    const previous = enabled;
    setEnabled(next);
    setBusy(true);
    setMessage("");
    try {
      const { data, error } = await createClient().rpc(
        "set_important_email_updates_enabled",
        { p_enabled: next },
      );
      if (error || data !== next) throw new Error("Preference update failed.");
      setMessage(next ? "Important emails are on." : "Important emails are off.");
    } catch {
      setEnabled(previous);
      setMessage("We couldn’t update your email preference. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-start gap-3">
        <input
          id="important-email-updates"
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void updatePreference(event.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-primary transition-opacity duration-[var(--motion-interaction-duration)] motion-reduce:transition-none disabled:opacity-60"
        />
        <div>
          <label htmlFor="important-email-updates" className="font-medium text-foreground">
            Email me about important updates
          </label>
          <p className="mt-1 text-muted-foreground">
            Receive task assignments and deadline reminders. Confidential task emails stay generic.
          </p>
        </div>
      </div>
      {busy ? <p role="status" className="text-muted-foreground">Saving…</p> : null}
      {message ? (
        <InlineAlert variant={message.startsWith("We") ? "error" : "info"}>
          {message}
        </InlineAlert>
      ) : null}
    </div>
  );
}

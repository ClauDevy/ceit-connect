"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import {
  getProfileNameErrorMessage,
  profileNameSchema,
} from "@/lib/profile";

export function FullNameForm({ currentName }: { currentName: string }) {
  const [name, setName] = useState(currentName);
  const [savedName, setSavedName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = profileNameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid full name.");
      setMessage("");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");

    try {
      const supabase = createClient();
      const { data, error: saveError } = await supabase.rpc(
        "update_own_profile",
        { p_full_name: parsed.data },
      );
      if (saveError) throw saveError;
      if (typeof data !== "string") throw new Error("Invalid profile response");

      setName(data);
      setSavedName(data);
      setMessage("Name saved.");
      router.refresh();
    } catch (saveError) {
      setError(getProfileNameErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  const parsedName = profileNameSchema.safeParse(name);
  const unchanged = parsedName.success && parsedName.data === savedName;

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <FormField label="Full name" error={error || null}>
        {(control) => (
          <Input
            {...control}
            required
            autoComplete="name"
            value={name}
            aria-invalid={Boolean(error)}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
              setMessage("");
            }}
          />
        )}
      </FormField>
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p
          role="status"
          aria-live="polite"
          className={
            message
              ? "motion-success-enter inline-flex items-center gap-1.5 text-sm font-medium text-accent-foreground"
              : unchanged
                ? "text-xs text-muted-foreground"
                : "text-xs font-semibold text-accent-foreground"
          }
        >
          {message ? <CheckCircle2 className="size-4" aria-hidden /> : null}
          {message || (unchanged ? "No unsaved changes." : "Unsaved changes")}
        </p>
        <Button
          type="submit"
          disabled={saving || unchanged}
          className="w-full sm:w-auto"
        >
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

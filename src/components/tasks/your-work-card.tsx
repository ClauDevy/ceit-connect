"use client";

import { type FormEvent, useId, useState } from "react";
import { ChevronDown, ExternalLink, Link2, Plus } from "lucide-react";
import { DrivePreview } from "@/components/tasks/drive-preview";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { defaultDriveLinkName, parseGoogleDriveLink } from "@/lib/google-drive";
import { cn } from "@/lib/utils";

export interface WorkLink {
  id: string;
  url: string;
  name?: string | null;
}

export interface NewWorkLink {
  url: string;
  name?: string;
}

interface YourWorkCardProps {
  links: readonly WorkLink[];
  isAssignee: boolean;
  onAddLink?: (link: NewWorkLink) => void | Promise<void>;
}

export function YourWorkCard({
  links,
  isAssignee,
  onAddLink,
}: YourWorkCardProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const fieldId = useId();
  const urlFieldId = `${fieldId}-url`;
  const nameFieldId = `${fieldId}-name`;
  const errorId = `${fieldId}-error`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseGoogleDriveLink(url);

    if (!parsed) {
      setError(
        "Paste a valid HTTPS Google Drive, Docs, Sheets, or Slides link.",
      );
      return;
    }

    if (!onAddLink) return;

    setError(null);
    setIsAdding(true);
    try {
      await onAddLink({ url: parsed.openUrl, name: name.trim() || undefined });
      setUrl("");
      setName("");
    } catch {
      setError("The link could not be added. Please try again.");
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your Work</CardTitle>
        <CardDescription>
          Google Drive links stay in Drive; nothing uploads to CEIT Connect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAssignee ? (
          <form className="space-y-3" onSubmit={handleSubmit}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.55fr)_auto]">
              <div>
                <label htmlFor={urlFieldId} className="sr-only">
                  Google Drive share link
                </label>
                <Input
                  id={urlFieldId}
                  type="url"
                  inputMode="url"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="Paste a Google Drive share link"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? errorId : undefined}
                  disabled={isAdding}
                />
              </div>
              <div>
                <label htmlFor={nameFieldId} className="sr-only">
                  Display name (optional)
                </label>
                <Input
                  id={nameFieldId}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Name (optional)"
                  maxLength={120}
                  disabled={isAdding}
                />
              </div>
              <Button
                type="submit"
                className="h-10"
                disabled={isAdding || !onAddLink}
              >
                <Plus aria-hidden="true" />
                Add link
              </Button>
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}

        {links.length ? (
          <div className="space-y-2">
            {links.map((link) => {
              const parsed = parseGoogleDriveLink(link.url);
              const displayName =
                link.name?.trim() ||
                (parsed
                  ? defaultDriveLinkName(parsed.type)
                  : "Unavailable Drive link");
              const isPreviewOpen = openPreviewId === link.id;

              return (
                <div
                  key={link.id}
                  className="overflow-hidden rounded-xl border border-border"
                >
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-primary">
                      <Link2 aria-hidden="true" className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {displayName}
                      </p>
                      <p className="text-xs capitalize text-muted-foreground">
                        {parsed?.type ?? "Invalid link"}
                      </p>
                    </div>
                    {parsed ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          render={
                            <a
                              href={parsed.openUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          }
                        >
                          Open
                          <ExternalLink aria-hidden="true" />
                        </Button>
                        {parsed.previewUrl ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-expanded={isPreviewOpen}
                            aria-controls={`work-link-preview-${link.id}`}
                            onClick={() =>
                              setOpenPreviewId(isPreviewOpen ? null : link.id)
                            }
                          >
                            Preview
                            <ChevronDown
                              aria-hidden="true"
                              className={cn(
                                "transition-transform",
                                isPreviewOpen && "rotate-180",
                              )}
                            />
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  {isPreviewOpen && parsed?.previewUrl ? (
                    <div
                      id={`work-link-preview-${link.id}`}
                      className="border-t border-border p-3.5"
                    >
                      <DrivePreview
                        url={link.url}
                        title={`${displayName} preview`}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            No resources linked yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

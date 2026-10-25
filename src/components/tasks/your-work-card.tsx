"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import {
  ChevronDown,
  Ellipsis,
  Link2,
  LoaderCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { DrivePreview } from "@/components/tasks/drive-preview";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Collapse } from "@/components/shared/motion";
import { StretchedExternalLink } from "@/components/shared/stretched-link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { defaultDriveLinkName, parseGoogleDriveLink } from "@/lib/google-drive";
import { cn } from "@/lib/utils";

export interface WorkLink {
  id: string;
  url: string;
  name?: string | null;
  can_remove?: boolean;
}

export interface NewWorkLink {
  url: string;
  name?: string;
}

interface YourWorkCardProps {
  links: readonly WorkLink[];
  isAssignee: boolean;
  onAddLink?: (link: NewWorkLink) => void | Promise<void>;
  onRemoveLink?: (linkId: string) => void | Promise<void>;
}

export function YourWorkCard({
  links,
  isAssignee,
  onAddLink,
  onRemoveLink,
}: YourWorkCardProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorkLink | null>(null);
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const addInFlight = useRef(false);
  const removeInFlight = useRef(false);
  const fieldId = useId();
  const urlFieldId = `${fieldId}-url`;
  const nameFieldId = `${fieldId}-name`;
  const errorId = `${fieldId}-error`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (addInFlight.current) return;
    const parsed = parseGoogleDriveLink(url);

    if (!parsed) {
      setError(
        "Paste a valid HTTPS Google Drive, Docs, Sheets, or Slides link.",
      );
      return;
    }

    setError(null);
    if (!onAddLink) return;

    addInFlight.current = true;
    setIsAdding(true);
    try {
      await onAddLink({ url: parsed.openUrl, name: name.trim() || undefined });
      setUrl("");
      setName("");
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The link could not be added. Please try again.",
      );
    } finally {
      addInFlight.current = false;
      setIsAdding(false);
    }
  }

  async function handleRemove(linkId: string) {
    if (!onRemoveLink || removeInFlight.current) return;

    removeInFlight.current = true;
    setRemovingId(linkId);
    setError(null);
    try {
      await onRemoveLink(linkId);
      setOpenPreviewId((current) => (current === linkId ? null : current));
      setRemoveTarget(null);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "The link could not be removed. Please try again.",
      );
    } finally {
      removeInFlight.current = false;
      setRemovingId(null);
    }
  }

  return (
    <Card>
      <CardHeader className="px-4 pt-4 pb-0 sm:px-5 sm:pt-5">
        <CardTitle className="text-[15px]">Your Work</CardTitle>
        <CardDescription>
          Google Drive links stay in Drive; nothing uploads to CEIT Connect.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pt-3 pb-4 sm:px-5 sm:pb-5">
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
                  <div className="relative flex items-center gap-3 px-3.5 py-3">
                    {parsed ? (
                      <StretchedExternalLink
                        href={parsed.openUrl}
                        label={`Open ${displayName} in Google Drive`}
                      />
                    ) : null}
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
                        {parsed.previewUrl ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="relative z-20"
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
                                "transition-transform duration-[var(--motion-enter-duration)] ease-[var(--motion-enter-easing)] motion-reduce:transition-none",
                                isPreviewOpen && "rotate-180",
                              )}
                            />
                          </Button>
                        ) : null}
                        {link.can_remove && onRemoveLink ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              aria-label={`More actions for ${displayName}`}
                              aria-busy={removingId === link.id}
                              disabled={removingId !== null}
                              className="relative z-20 inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors duration-150 hover:bg-accent hover:text-accent-foreground active:bg-accent/80 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none sm:size-9"
                            >
                              {removingId === link.id ? (
                                <LoaderCircle
                                  aria-hidden="true"
                                  className="size-4 motion-safe:animate-spin"
                                />
                              ) : (
                                <Ellipsis
                                  aria-hidden="true"
                                  className="size-5"
                                />
                              )}
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              aria-label={`Actions for ${displayName}`}
                            >
                              <DropdownMenuItem
                                className="text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
                                onClick={() => {
                                  setError(null);
                                  setRemoveTarget(link);
                                }}
                              >
                                <Trash2 aria-hidden="true" className="size-4" />
                                Remove link
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                  {parsed?.previewUrl ? (
                    <Collapse open={isPreviewOpen}>
                      <div
                        id={`work-link-preview-${link.id}`}
                        className="border-t border-border p-3.5"
                      >
                        <DrivePreview
                          url={link.url}
                          title={`${displayName} preview`}
                        />
                      </div>
                    </Collapse>
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
        {error && !isAssignee ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </CardContent>
      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null);
            setError(null);
          }
        }}
        title="Remove this link?"
        description="This removes the link from the task. The file stays in Google Drive."
        confirmLabel="Remove link"
        destructive
        loading={removingId !== null}
        error={removeTarget ? error : null}
        onConfirm={() => {
          if (removeTarget) void handleRemove(removeTarget.id);
        }}
      />
    </Card>
  );
}

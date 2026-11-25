"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import {
  ExternalLink,
  Maximize2,
  RectangleHorizontal,
  RectangleVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { parseGoogleDriveLink, type DriveItemType } from "@/lib/google-drive";

interface DrivePreviewProps {
  url: string;
  title?: string;
}

// Phone frame shape per Drive item type. Slides are always landscape, Sheets are
// wide, Docs are tall. A plain Drive "file" can be a PDF (tall) or a video (wide)
// and we can't tell which, so it starts tall and the viewer can switch to wide.
const MOBILE_ASPECT: Record<DriveItemType, string> = {
  file: "aspect-[3/4]",
  folder: "aspect-[3/4]",
  document: "aspect-[3/4]",
  spreadsheet: "aspect-[4/3]",
  presentation: "aspect-video",
};

export function DrivePreview({
  url,
  title = "Google Drive preview",
}: DrivePreviewProps) {
  const [wide, setWide] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Element fullscreen isn't available everywhere (e.g. iPhone Safari), so the
  // button only shows when the browser supports it.
  const canFullscreen = useSyncExternalStore(
    () => () => {},
    () => document.fullscreenEnabled === true,
    () => false,
  );
  const parsed = parseGoogleDriveLink(url);

  if (!parsed) {
    return (
      <p className="text-xs text-destructive">
        Preview unavailable because this is not a valid Google Drive link.
      </p>
    );
  }

  const canToggleShape = parsed.type === "file" && Boolean(parsed.previewUrl);

  return (
    <div className="min-w-0 max-w-full space-y-2 overflow-hidden">
      {parsed.previewUrl ? (
        <iframe
          ref={iframeRef}
          className={cn(
            "block w-full max-w-full rounded-xl border border-border bg-muted sm:aspect-[16/10]",
            wide ? "aspect-video" : MOBILE_ASPECT[parsed.type],
          )}
          src={parsed.previewUrl}
          title={title}
          sandbox="allow-same-origin allow-scripts allow-popups"
          allow="fullscreen; autoplay; picture-in-picture; encrypted-media"
          allowFullScreen
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : null}

      {parsed.previewUrl && (canToggleShape || canFullscreen) ? (
        <div className="flex flex-wrap gap-2 sm:hidden">
          {canFullscreen ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void iframeRef.current?.requestFullscreen().catch(() => {});
              }}
            >
              <Maximize2 aria-hidden="true" />
              Full screen
            </Button>
          ) : null}
          {canToggleShape ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={wide}
              onClick={() => setWide((current) => !current)}
            >
              {wide ? (
                <RectangleVertical aria-hidden="true" />
              ) : (
                <RectangleHorizontal aria-hidden="true" />
              )}
              {wide ? "Tall view (PDF)" : "Wide view (video)"}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 break-words text-xs text-muted-foreground">
          {parsed.previewUrl
            ? "Preview unavailable? Check the file's sharing settings."
            : "Preview unavailable for folders. Open it in Google Drive instead."}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="max-w-full"
          nativeButton={false}
          render={
            <a
              href={parsed.openUrl}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          Open link
          <ExternalLink aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

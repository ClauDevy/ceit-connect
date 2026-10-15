import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseGoogleDriveLink } from "@/lib/google-drive";

interface DrivePreviewProps {
  url: string;
  title?: string;
}

export function DrivePreview({
  url,
  title = "Google Drive preview",
}: DrivePreviewProps) {
  const parsed = parseGoogleDriveLink(url);

  if (!parsed) {
    return (
      <p className="text-xs text-destructive">
        Preview unavailable because this is not a valid Google Drive link.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {parsed.previewUrl ? (
        <iframe
          className="aspect-[16/10] w-full rounded-xl border border-border bg-muted"
          src={parsed.previewUrl}
          title={title}
          sandbox="allow-same-origin allow-scripts allow-popups"
          referrerPolicy="no-referrer"
          loading="lazy"
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {parsed.previewUrl
            ? "Preview unavailable? Check the file's sharing settings."
            : "Preview unavailable for folders. Open it in Google Drive instead."}
        </p>
        <Button
          variant="outline"
          size="sm"
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

"use client";

import { useState } from "react";
import { ImageIcon } from "lucide-react";
import { TigerLogo } from "@/components/ui/tiger-logo";
import { cn } from "@/lib/utils";

export function EventBanner({
  src,
  alt,
  className,
  compact = false,
  loading,
  decoding,
}: {
  src: string | null;
  alt: string;
  className?: string;
  compact?: boolean;
  loading?: "eager" | "lazy";
  decoding?: "async" | "auto" | "sync";
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = Boolean(src && src !== failedSrc);

  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-gradient-to-br from-primary/15 via-muted to-accent/30",
        className,
      )}
    >
      {showImage ? (
        // Public Supabase Storage images are already cropped and compressed.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt={alt}
          loading={loading}
          decoding={decoding}
          className="size-full object-cover"
          onError={() => setFailedSrc(src)}
        />
      ) : compact ? (
        <ImageIcon className="size-5 text-muted-foreground/60" aria-hidden />
      ) : (
        <TigerLogo size={72} className="opacity-20" />
      )}
    </div>
  );
}

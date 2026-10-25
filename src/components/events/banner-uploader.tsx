"use client";

import { useEffect, useRef, useState } from "react";
import imageCompression from "browser-image-compression";
import { Crop, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { BannerCropper } from "@/components/events/banner-cropper";
import { EventBanner } from "@/components/events/event-banner";
import { Button } from "@/components/ui/button";
import { InlineAlert } from "@/components/ui/inline-alert";
import {
  MAX_BANNER_BYTES,
  removeEventBanner,
  uploadEventBanner,
} from "@/lib/event-banner";
import { getCroppedBlob, type CropArea } from "@/lib/image";

const ALLOWED_SOURCE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const TARGET_ASPECT_RATIO = 16 / 9;
const ASPECT_RATIO_TOLERANCE = 0.02;

function getNaturalDimensions(file: File) {
  const objectUrl = URL.createObjectURL(file);

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("The image dimensions could not be read."));
        return;
      }
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("The selected image could not be loaded."));
    };
    image.src = objectUrl;
  });
}

function isCloseToBannerRatio(width: number, height: number) {
  const ratio = width / height;
  return (
    Math.abs(ratio - TARGET_ASPECT_RATIO) / TARGET_ASPECT_RATIO <=
    ASPECT_RATIO_TOLERANCE
  );
}

export function BannerUploader({
  eventName,
  eventId,
  currentBannerUrl,
  expectedUpdatedAt,
  pendingFile,
  onPendingFileChange,
  onSaved,
}: {
  eventName: string;
  eventId?: string;
  currentBannerUrl: string | null;
  expectedUpdatedAt?: string;
  pendingFile: File | null;
  onPendingFileChange: (file: File | null) => void;
  onSaved: (bannerUrl: string | null, updatedAt: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [cropSourceFile, setCropSourceFile] = useState<File | null>(null);
  const [adjustableSourceFile, setAdjustableSourceFile] =
    useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(
    null,
  );
  const [status, setStatus] = useState<
    "idle" | "processing" | "saving" | "removing"
  >("idle");
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    },
    [sourceUrl],
  );

  useEffect(
    () => () => {
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    },
    [pendingPreviewUrl],
  );

  function closeCropper() {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setSourceUrl(null);
    setCropSourceFile(null);
  }

  function openCropper(file: File) {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    setCropSourceFile(file);
    setSourceUrl(URL.createObjectURL(file));
  }

  async function prepareBannerFile(file: File) {
    const compressed = await imageCompression(file, {
      maxSizeMB: 1.45,
      maxWidthOrHeight: 1920,
      fileType: "image/webp",
      useWebWorker: true,
    });
    const bannerFile = new File([compressed], "event-banner.webp", {
      type: "image/webp",
    });

    if (bannerFile.size > MAX_BANNER_BYTES) {
      throw new Error("The banner could not be compressed below 1.5 MB.");
    }

    return bannerFile;
  }

  async function storeBannerFile(bannerFile: File) {
    if (!eventId || !expectedUpdatedAt) {
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
      setPendingPreviewUrl(URL.createObjectURL(bannerFile));
      onPendingFileChange(bannerFile);
      return;
    }

    setStatus("saving");
    const result = await uploadEventBanner(
      eventId,
      expectedUpdatedAt,
      bannerFile,
    );
    onSaved(result.bannerUrl, result.updatedAt);
    onPendingFileChange(null);
  }

  async function selectFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_SOURCE_TYPES.has(file.type)) {
      setError("Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      setError("Choose an image under 20 MB before cropping.");
      return;
    }

    setError("");
    setStatus("processing");

    try {
      const { width, height } = await getNaturalDimensions(file);
      if (!isCloseToBannerRatio(width, height)) {
        openCropper(file);
        setStatus("idle");
        return;
      }

      const bannerFile = await prepareBannerFile(file);
      await storeBannerFile(bannerFile);
      setAdjustableSourceFile(file);
      setStatus("idle");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong processing the image.",
      );
      setStatus("idle");
    }
  }

  async function saveCrop(area: CropArea) {
    if (!sourceUrl || !cropSourceFile) return false;
    setStatus("processing");
    setError("");

    try {
      const croppedBlob = await getCroppedBlob(sourceUrl, area);
      const croppedFile = new File([croppedBlob], "event-banner.webp", {
        type: "image/webp",
      });
      const bannerFile = await prepareBannerFile(croppedFile);
      const sourceFile = cropSourceFile;

      await storeBannerFile(bannerFile);
      setAdjustableSourceFile(sourceFile);
      setStatus("idle");
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong processing the image.",
      );
      setStatus("idle");
      return false;
    }
  }

  function clearPending() {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl);
    setPendingPreviewUrl(null);
    onPendingFileChange(null);
    setAdjustableSourceFile(null);
    setError("");
  }

  async function removeSavedBanner() {
    if (!eventId || !expectedUpdatedAt) return;
    setStatus("removing");
    setError("");

    try {
      const result = await removeEventBanner(eventId, expectedUpdatedAt);
      onSaved(result.bannerUrl, result.updatedAt);
      setAdjustableSourceFile(null);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The banner could not be removed.",
      );
    } finally {
      setStatus("idle");
    }
  }

  const previewUrl = pendingFile ? pendingPreviewUrl : currentBannerUrl;
  const busy = status !== "idle";

  return (
    <div className="grid gap-3">
      <div className="overflow-hidden rounded-xl border-2 border-dashed">
        <EventBanner
          src={previewUrl}
          alt={`${eventName || "Event"} banner`}
          className="aspect-video w-full"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {status === "saving" || status === "processing" ? (
            <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
          ) : (
            <ImagePlus aria-hidden />
          )}
          {previewUrl ? "Replace banner" : "Choose banner"}
        </Button>
        {previewUrl ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            className="text-muted-foreground hover:text-destructive"
            onClick={pendingFile ? clearPending : removeSavedBanner}
          >
            {status === "removing" ? (
              <LoaderCircle className="motion-safe:animate-spin" aria-hidden />
            ) : (
              <Trash2 aria-hidden />
            )}
            {status === "removing" ? "Removing…" : "Remove"}
          </Button>
        ) : null}
        {previewUrl && adjustableSourceFile ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => openCropper(adjustableSourceFile)}
          >
            <Crop aria-hidden />
            Adjust crop
          </Button>
        ) : null}
        <input
          ref={fileInput}
          id="event-banner-input"
          type="file"
          aria-label="Choose event banner image"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={selectFile}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        JPEG, PNG, or WebP. Near-16:9 images are used as-is; you can still
        adjust the crop. The saved banner is compressed below 1.5 MB.
      </p>
      {error ? <InlineAlert>{error}</InlineAlert> : null}

      {sourceUrl ? (
        <BannerCropper
          imageSrc={sourceUrl}
          processing={status === "processing"}
          onSave={saveCrop}
          onCancel={closeCropper}
        />
      ) : null}
    </div>
  );
}

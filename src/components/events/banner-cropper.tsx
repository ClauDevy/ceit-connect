"use client";

import { useCallback, useState } from "react";
import Cropper from "react-easy-crop";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  minimumContainZoom,
  type CropArea,
  type ImageSize,
} from "@/lib/image";

export function BannerCropper({
  imageSrc,
  processing,
  onSave,
  onCancel,
}: {
  imageSrc: string;
  processing: boolean;
  onSave: (area: CropArea) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const [mediaSize, setMediaSize] = useState<ImageSize | null>(null);
  const [cropSize, setCropSize] = useState<ImageSize | null>(null);
  const [open, setOpen] = useState(true);
  const onCropComplete = useCallback(
    (_: CropArea, pixels: CropArea) => setArea(pixels),
    [],
  );
  const applyContainZoom = useCallback(
    (media: ImageSize, viewport: ImageSize) => {
      const nextMinZoom = minimumContainZoom(media, viewport);
      setMinZoom(nextMinZoom);
      setZoom(nextMinZoom);
      setCrop({ x: 0, y: 0 });
    },
    [],
  );

  function closeCropper() {
    setOpen(false);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      onCancel();
    }
  }

  function requestClose() {
    if (processing) return;
    closeCropper();
  }

  async function saveAndClose() {
    if (!area) return;
    if (await onSave(area)) closeCropper();
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
      <DialogContent
        className={!open ? "pointer-events-none max-w-3xl" : "max-w-3xl"}
        showCloseButton={!processing}
        aria-hidden={!open || undefined}
        inert={!open ? true : undefined}
        onTransitionEnd={(event) => {
          if (
            event.target === event.currentTarget &&
            event.propertyName === "opacity" &&
            !open
          ) onCancel();
        }}
      >
        <DialogHeader>
          <DialogTitle>Crop event banner</DialogTitle>
          <DialogDescription>
            Position the image inside the 16:9 frame. It will be converted to
            WebP and compressed below 1.5 MB.
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-gradient-to-br from-primary/15 via-muted to-accent/30">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            minZoom={minZoom}
            aspect={16 / 9}
            restrictPosition={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            onMediaLoaded={(nextMediaSize) => {
              setMediaSize(nextMediaSize);
              if (cropSize) applyContainZoom(nextMediaSize, cropSize);
            }}
            onCropSizeChange={(nextCropSize) => {
              setCropSize(nextCropSize);
              if (mediaSize) applyContainZoom(mediaSize, nextCropSize);
            }}
          />
        </div>

        <label
          htmlFor="banner-zoom"
          className="grid gap-1.5 text-sm font-semibold text-secondary-foreground"
        >
          Zoom
          <input
            id="banner-zoom"
            type="range"
            min={minZoom}
            max={3}
            step={0.1}
            value={zoom}
            disabled={processing}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </label>

        <DialogFooter>
          <Button variant="outline" disabled={processing} onClick={requestClose}>
            Cancel
          </Button>
          <Button
            disabled={processing || !area}
            onClick={() => void saveAndClose()}
          >
            {processing ? "Processing…" : "Use banner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

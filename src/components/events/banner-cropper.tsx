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
import type { CropArea } from "@/lib/image";

export function BannerCropper({
  imageSrc,
  processing,
  onSave,
  onCancel,
}: {
  imageSrc: string;
  processing: boolean;
  onSave: (area: CropArea) => void;
  onCancel: () => void;
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<CropArea | null>(null);
  const onCropComplete = useCallback(
    (_: CropArea, pixels: CropArea) => setArea(pixels),
    [],
  );

  return (
    <Dialog open onOpenChange={(open) => !open && !processing && onCancel()}>
      <DialogContent className="max-w-3xl" showCloseButton={!processing}>
        <DialogHeader>
          <DialogTitle>Crop event banner</DialogTitle>
          <DialogDescription>
            Position the image inside the 16:9 frame. It will be converted to
            WebP and compressed below 1.5 MB.
          </DialogDescription>
        </DialogHeader>

        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-foreground">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={16 / 9}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
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
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            disabled={processing}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-primary"
          />
        </label>

        <DialogFooter>
          <Button variant="outline" disabled={processing} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={processing || !area}
            onClick={() => area && onSave(area)}
          >
            {processing ? "Processing…" : "Use banner"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

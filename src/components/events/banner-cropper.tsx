"use client";

import { useState } from "react";
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
import { cn } from "@/lib/utils";
import { CropZoomRow } from "@/components/shared/crop-zoom-row";
import { useCropControls } from "@/components/shared/use-crop-controls";
import { type CropArea } from "@/lib/image";

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
  const controls = useCropControls();
  const { area, zoom, minZoom, maxZoom } = controls;
  const [open, setOpen] = useState(true);

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
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && requestClose()}
      // Tell the parent once the closing animation has finished, so the cropper is removed
      // and a new image can open it again. This does not rely on a CSS transition event.
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent
        className={cn(
          "max-w-3xl data-[ending-style]:scale-100 data-[starting-style]:scale-100",
          !open && "pointer-events-none",
        )}
        showCloseButton={!processing}
        aria-hidden={!open || undefined}
        inert={!open ? true : undefined}
      >
        <DialogHeader>
          <DialogTitle>Crop event banner</DialogTitle>
          <DialogDescription>
            Drag to position the image in the frame.
          </DialogDescription>
        </DialogHeader>

        <div className="relative isolate h-[min(52dvh,24rem)] min-h-56 w-full overflow-hidden rounded-xl bg-black">
          <Cropper image={imageSrc} aspect={16 / 9} {...controls.cropperProps} />
        </div>

        <CropZoomRow
          id="banner-zoom"
          zoom={zoom}
          minZoom={minZoom}
          maxZoom={maxZoom}
          fit={controls.fit}
          canFit={controls.canFit}
          disabled={processing}
          onZoom={controls.setZoom}
          onToggleFit={controls.toggleFit}
        />

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

"use client"

import Cropper from "react-easy-crop"
import { Button } from "@/components/ui/button"
import { CropZoomRow } from "@/components/shared/crop-zoom-row"
import { useCropControls } from "@/components/shared/use-crop-controls"
import { type CropArea } from "@/lib/image"

type AvatarCropperProps = {
  imageSrc: string
  saving: boolean
  onSave: (area: CropArea) => void
  onCancel: () => void
}

export function AvatarCropper({ imageSrc, saving, onSave, onCancel }: AvatarCropperProps) {
  const controls = useCropControls()

  return (
    <div className="grid gap-4">
      <div className="relative isolate h-72 w-full overflow-hidden rounded-xl bg-black">
        <Cropper image={imageSrc} aspect={1} {...controls.cropperProps} />
      </div>

      <CropZoomRow
        id="avatar-zoom"
        zoom={controls.zoom}
        minZoom={controls.minZoom}
        maxZoom={controls.maxZoom}
        fit={controls.fit}
        canFit={controls.canFit}
        disabled={saving}
        onZoom={controls.setZoom}
        onToggleFit={controls.toggleFit}
      />

      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
        <Button disabled={saving || !controls.area} onClick={() => controls.area && onSave(controls.area)}>
          {saving ? "Saving…" : "Save photo"}
        </Button>
      </div>
    </div>
  )
}

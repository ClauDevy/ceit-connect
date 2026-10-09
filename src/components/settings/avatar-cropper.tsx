"use client"

import { useCallback, useState } from "react"
import Cropper from "react-easy-crop"
import { Button } from "@/components/ui/button"
import type { CropArea } from "@/lib/image"

type AvatarCropperProps = {
  imageSrc: string
  saving: boolean
  onSave: (area: CropArea) => void
  onCancel: () => void
}

export function AvatarCropper({ imageSrc, saving, onSave, onCancel }: AvatarCropperProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [area, setArea] = useState<CropArea | null>(null)

  const onCropComplete = useCallback((_: CropArea, pixels: CropArea) => setArea(pixels), [])

  return (
    <div className="grid gap-4">
      <div className="relative h-64 w-full overflow-hidden rounded-xl bg-black sm:h-72">
        <Cropper
          image={imageSrc}
          crop={crop}
          zoom={zoom}
          aspect={1}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>

      <label className="grid gap-1.5 text-sm font-semibold text-secondary-foreground">
        Zoom
        <input
          type="range"
          min={1}
          max={3}
          step={0.1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="w-full accent-primary"
        />
      </label>

      <div className="flex gap-2">
        <Button disabled={saving || !area} onClick={() => area && onSave(area)}>
          {saving ? "Saving…" : "Save photo"}
        </Button>
        <Button variant="outline" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

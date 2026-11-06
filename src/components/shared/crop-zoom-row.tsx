"use client";

import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";

/** One tidy row under a cropper: Zoom label, slider and a Fit toggle that visibly shows when it is on. */
export function CropZoomRow({
  id,
  zoom,
  minZoom,
  maxZoom,
  fit,
  canFit,
  disabled,
  onZoom,
  onToggleFit,
}: {
  id: string;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  fit: boolean;
  canFit: boolean;
  disabled?: boolean;
  onZoom: (zoom: number) => void;
  onToggleFit: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label htmlFor={id} className="shrink-0 text-sm font-semibold text-secondary-foreground">
        Zoom
      </label>
      <input
        id={id}
        type="range"
        min={minZoom}
        max={maxZoom}
        step={0.01}
        value={zoom}
        disabled={disabled}
        onChange={(event) => onZoom(Number(event.target.value))}
        className="min-w-0 flex-1 accent-primary"
      />
      <Button
        type="button"
        size="sm"
        variant={fit ? "default" : "outline"}
        aria-pressed={fit}
        disabled={disabled || !canFit}
        onClick={onToggleFit}
        className="shrink-0"
      >
        {fit ? <Check aria-hidden /> : null} Fit
      </Button>
    </div>
  );
}

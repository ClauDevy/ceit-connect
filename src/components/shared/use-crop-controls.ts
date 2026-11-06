"use client";

import { useCallback, useRef, useState } from "react";
import {
  CROP_FREE_MIN_ZOOM,
  CROP_MAX_ZOOM,
  clampCropOffset,
  fitWidthZoom,
  minimumContainZoom,
  type CropArea,
  type ImageSize,
} from "@/lib/image";

/**
 * Shared zoom/pan rules for the avatar and banner croppers.
 * - Fit OFF (default): zoom all the way out and move freely; black may show around the image.
 * - Fit ON: the image is as wide as the frame and the frame can never move onto blank space.
 */
export function useCropControls() {
  const [crop, setCropState] = useState({ x: 0, y: 0 });
  const [zoom, setZoomState] = useState(1);
  const [containZoom, setContainZoom] = useState(1);
  const [fit, setFit] = useState(false);
  const [area, setArea] = useState<CropArea | null>(null);
  const [mediaSize, setMediaSize] = useState<ImageSize | null>(null);
  const [cropSize, setCropSize] = useState<ImageSize | null>(null);

  const minZoom = fit ? containZoom : Math.min(CROP_FREE_MIN_ZOOM, containZoom);
  const maxZoom = Math.max(CROP_MAX_ZOOM, containZoom);
  const mode = fit ? "inside" : "free";

  const onCropComplete = useCallback(
    (_: CropArea, pixels: CropArea) => setArea(pixels),
    [],
  );

  // The cropper reports the image size and the frame size separately, in either order.
  // Refs keep the latest of each so whichever arrives second can finish the first fit.
  const mediaSizeRef = useRef<ImageSize | null>(null);
  const cropSizeRef = useRef<ImageSize | null>(null);
  const initialFitDoneRef = useRef(false);

  const applyInitialFitWhenReady = useCallback(() => {
    const media = mediaSizeRef.current;
    const frame = cropSizeRef.current;
    if (initialFitDoneRef.current || !media || !frame) return;
    initialFitDoneRef.current = true;
    const next = minimumContainZoom(media, frame);
    setContainZoom(next);
    setZoomState(next);
    setCropState({ x: 0, y: 0 });
    setFit(false);
  }, []);

  const handleMediaLoaded = useCallback(
    (nextMediaSize: ImageSize) => {
      // A new image starts a new once-per-image fit.
      mediaSizeRef.current = nextMediaSize;
      initialFitDoneRef.current = false;
      setMediaSize(nextMediaSize);
      applyInitialFitWhenReady();
    },
    [applyInitialFitWhenReady],
  );

  const handleCropSizeChange = useCallback(
    (nextCropSize: ImageSize) => {
      cropSizeRef.current = nextCropSize;
      setCropSize(nextCropSize);
      if (!initialFitDoneRef.current) {
        applyInitialFitWhenReady();
        return;
      }
      // After the first fit only the contain zoom follows the frame; the person's
      // zoom, position and Fit setting stay as they are.
      const media = mediaSizeRef.current;
      if (media) setContainZoom(minimumContainZoom(media, nextCropSize));
    },
    [applyInitialFitWhenReady],
  );

  const setZoom = useCallback(
    (nextZoom: number) => {
      const clamped = Math.min(maxZoom, Math.max(minZoom, nextZoom));
      setZoomState(clamped);
      setCropState((current) =>
        clampCropOffset(current, mediaSize, cropSize, clamped, mode),
      );
    },
    [cropSize, maxZoom, mediaSize, minZoom, mode],
  );

  const setCrop = useCallback(
    (next: { x: number; y: number }) =>
      setCropState(clampCropOffset(next, mediaSize, cropSize, zoom, mode)),
    [cropSize, mediaSize, zoom, mode],
  );

  const toggleFit = useCallback(() => {
    if (!mediaSize || !cropSize) return;
    if (fit) {
      setFit(false);
      return;
    }
    setFit(true);
    setZoomState(fitWidthZoom(mediaSize, cropSize, containZoom, maxZoom));
    setCropState({ x: 0, y: 0 });
  }, [containZoom, cropSize, fit, maxZoom, mediaSize]);

  return {
    area,
    zoom,
    minZoom,
    maxZoom,
    fit,
    setZoom,
    toggleFit,
    canFit: mediaSize !== null && cropSize !== null,
    // Spread onto <Cropper>. The library's own restriction cannot draw a
    // zoomed-out image, so the clamp above does the work instead.
    cropperProps: {
      crop,
      zoom,
      minZoom,
      maxZoom,
      restrictPosition: false,
      onCropChange: setCrop,
      onZoomChange: setZoom,
      onCropComplete,
      onMediaLoaded: handleMediaLoaded,
      onCropSizeChange: handleCropSizeChange,
    },
  };
}

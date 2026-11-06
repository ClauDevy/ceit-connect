export type CropArea = { x: number; y: number; width: number; height: number }
export type ImageSize = { width: number; height: number }

export type CropDrawPlan = {
  output: ImageSize
  source: CropArea | null
  destination: CropArea | null
}

export function minimumContainZoom(media: ImageSize, crop: ImageSize) {
  if (
    media.width <= 0 ||
    media.height <= 0 ||
    crop.width <= 0 ||
    crop.height <= 0
  ) {
    return 1
  }

  return Math.min(1, crop.width / media.width, crop.height / media.height)
}

/** Longest side the crop canvas may have, so a zoomed-out crop cannot ask for a huge canvas. */
export const MAX_CROP_OUTPUT_SIDE = 4096

export function getCropDrawPlan(image: ImageSize, crop: CropArea): CropDrawPlan {
  // Zoomed far out, the crop area can be several times larger than the picture. Shrink the
  // output (the picture and its blank padding scale together through scaleX/scaleY below).
  const longestSide = Math.max(crop.width, crop.height)
  const limit = longestSide > MAX_CROP_OUTPUT_SIDE ? MAX_CROP_OUTPUT_SIDE / longestSide : 1
  const output = {
    width: Math.max(1, Math.round(crop.width * limit)),
    height: Math.max(1, Math.round(crop.height * limit)),
  }
  const sourceX = Math.max(0, crop.x)
  const sourceY = Math.max(0, crop.y)
  const sourceRight = Math.min(image.width, crop.x + crop.width)
  const sourceBottom = Math.min(image.height, crop.y + crop.height)
  const sourceWidth = Math.max(0, sourceRight - sourceX)
  const sourceHeight = Math.max(0, sourceBottom - sourceY)

  if (sourceWidth === 0 || sourceHeight === 0 || crop.width <= 0 || crop.height <= 0) {
    return { output, source: null, destination: null }
  }

  const scaleX = output.width / crop.width
  const scaleY = output.height / crop.height
  return {
    output,
    source: { x: sourceX, y: sourceY, width: sourceWidth, height: sourceHeight },
    destination: {
      x: (sourceX - crop.x) * scaleX,
      y: (sourceY - crop.y) * scaleY,
      width: sourceWidth * scaleX,
      height: sourceHeight * scaleY,
    },
  }
}

/** Draws the chosen crop region to a canvas and returns it as a WebP blob. */
export async function getCroppedBlob(imageSrc: string, crop: CropArea): Promise<Blob> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error("Failed to load image"))
    image.src = imageSrc
  })

  const plan = getCropDrawPlan(
    { width: image.naturalWidth, height: image.naturalHeight },
    crop,
  )
  const canvas = document.createElement("canvas")
  canvas.width = plan.output.width
  canvas.height = plan.output.height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Failed to create crop canvas")

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (plan.source && plan.destination) {
    ctx.drawImage(
      image,
      plan.source.x,
      plan.source.y,
      plan.source.width,
      plan.source.height,
      plan.destination.x,
      plan.destination.y,
      plan.destination.width,
      plan.destination.height,
    )
  }

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      } else {
        reject(new Error("Failed to create cropped image"))
      }
    }, "image/webp", 0.9)
  })
}

export const CROP_MAX_ZOOM = 3

type CropOffset = { x: number; y: number }

export const CROP_FREE_MIN_ZOOM = 0.2

/**
 * Limits how far the image can be dragged (react-easy-crop's `crop` offset, in screen px).
 * - "inside" (Fit on): the frame never leaves the picture. On an axis where the zoomed image
 *   is smaller than the frame, the image stays centred.
 * - "free" (Fit off): the image may be zoomed out and moved so black shows around it, but a
 *   quarter of the frame always still overlaps the picture so it cannot be lost.
 */
export function clampCropOffset(
  offset: CropOffset,
  media: ImageSize | null,
  frame: ImageSize | null,
  zoom: number,
  mode: "inside" | "free" = "inside",
): CropOffset {
  if (!media || !frame) return offset
  const limit = (mediaLength: number, frameLength: number) =>
    mode === "inside"
      ? Math.max(0, (mediaLength * zoom - frameLength) / 2)
      : Math.max(0, (mediaLength * zoom + frameLength) / 2 - frameLength * 0.25)
  const limitX = limit(media.width, frame.width)
  const limitY = limit(media.height, frame.height)
  return {
    x: Math.min(limitX, Math.max(-limitX, offset.x)),
    y: Math.min(limitY, Math.max(-limitY, offset.y)),
  }
}

/**
 * Zoom at which the picture just covers the frame (no blank margin on either axis), kept
 * inside the allowed range. For a picture with the frame's shape this is "as wide as the frame".
 */
export function fitCoverZoom(
  media: ImageSize,
  frame: ImageSize,
  minZoom: number,
  maxZoom: number = CROP_MAX_ZOOM,
) {
  if (media.width <= 0 || media.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return Math.max(minZoom, 1)
  }
  const cover = Math.max(frame.width / media.width, frame.height / media.height)
  return Math.min(Math.max(cover, minZoom), Math.max(minZoom, maxZoom))
}

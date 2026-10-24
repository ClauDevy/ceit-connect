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

export function getCropDrawPlan(image: ImageSize, crop: CropArea): CropDrawPlan {
  const output = {
    width: Math.max(1, Math.round(crop.width)),
    height: Math.max(1, Math.round(crop.height)),
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

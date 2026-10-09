export type CropArea = { x: number; y: number; width: number; height: number }

/** Draws the chosen crop region to a canvas and returns it as a WebP blob. */
export async function getCroppedBlob(imageSrc: string, crop: CropArea): Promise<Blob> {
  const image = new Image()
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve()
    image.onerror = () => reject(new Error("Failed to load image"))
    image.src = imageSrc
  })

  const canvas = document.createElement("canvas")
  canvas.width = crop.width
  canvas.height = crop.height
  const ctx = canvas.getContext("2d")!

  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)

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

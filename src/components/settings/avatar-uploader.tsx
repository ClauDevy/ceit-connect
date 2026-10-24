"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import imageCompression from "browser-image-compression"
import { Button } from "@/components/ui/button"
import { InlineAlert } from "@/components/ui/inline-alert"
import { UserAvatar } from "@/components/shared/user-avatar"
import { AvatarCropper } from "@/components/settings/avatar-cropper"
import { nextAvatarCleanupWarning } from "@/lib/avatar"
import { createClient } from "@/lib/supabase/client"
import { getCroppedBlob, type CropArea } from "@/lib/image"

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

export function AvatarUploader({
  userId,
  userName,
  currentAvatarUrl,
}: {
  userId: string
  userName: string
  currentAvatarUrl: string | null
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [status, setStatus] = useState<"idle" | "saving" | "removing" | "error">("idle")
  const [error, setError] = useState("")
  const [cleanupWarning, setCleanupWarning] = useState("")
  const [preview, setPreview] = useState(currentAvatarUrl)
  const fileInput = useRef<HTMLInputElement>(null)
  const router = useRouter()

  function closeCropper() {
    if (imageSrc) URL.revokeObjectURL(imageSrc)
    setImageSrc(null)
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Reset so picking the same file again still fires onChange.
    e.target.value = ""
    if (!file) return

    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Image must be under 2MB.")
      return
    }

    setError("")
    setImageSrc(URL.createObjectURL(file))
  }

  async function handleSave(area: CropArea) {
    if (!imageSrc) return
    setStatus("saving")
    setError("")
    setCleanupWarning("")

    try {
      const croppedBlob = await getCroppedBlob(imageSrc, area)
      const croppedFile = new File([croppedBlob], "avatar.webp", { type: "image/webp" })

      const compressedFile = await imageCompression(croppedFile, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 512,
        fileType: "image/webp",
      })

      const supabase = createClient()
      const path = `${userId}/avatar.webp`

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, compressedFile, { upsert: true, contentType: "image/webp" })

      if (uploadError) {
        setError(uploadError.message)
        setStatus("error")
        return
      }

      const res = await fetch("/api/update-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save" }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? "Failed to save avatar")
        setStatus("error")
        return
      }

      if (typeof data.avatarUrl !== "string") {
        setError("The saved photo response was invalid. Refresh and try again.")
        setStatus("error")
        return
      }

      setPreview(data.avatarUrl)
      closeCropper()
      setStatus("idle")
      router.refresh()
    } catch {
      setError("Something went wrong processing the image.")
      setStatus("error")
    }
  }

  async function handleRemove() {
    setStatus("removing")
    setError("")

    try {
      // The route clears the database first, then performs retry-safe cleanup.
      const res = await fetch("/api/update-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove" }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError(data.error ?? "Failed to remove avatar")
        return
      }

      setPreview(null)
      setCleanupWarning((currentWarning) =>
        nextAvatarCleanupWarning(currentWarning, data),
      )
      router.refresh()
    } catch {
      setError("Something went wrong removing the photo.")
    } finally {
      setStatus("idle")
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-col items-start gap-4 rounded-xl border bg-muted/20 p-4 sm:flex-row sm:items-center">
        <UserAvatar
          name={userName}
          src={preview}
          size="lg"
          className="ring-4 ring-background"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {preview ? "Your current photo" : "Add a profile photo"}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Square photos crop best. Images must be under 2MB and are compressed
            before upload.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={status === "saving"}
            onClick={() => fileInput.current?.click()}
          >
            {preview ? "Change photo" : "Choose photo"}
          </Button>
          {preview && (
            <Button
              variant="ghost"
              disabled={status === "saving" || status === "removing"}
              onClick={handleRemove}
              className="text-muted-foreground hover:text-destructive"
            >
              {status === "removing" ? "Removing…" : "Remove"}
            </Button>
          )}
          {!preview && cleanupWarning && (
            <Button
              variant="outline"
              disabled={status === "removing"}
              onClick={handleRemove}
            >
              {status === "removing" ? "Retrying…" : "Retry photo cleanup"}
            </Button>
          )}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {cleanupWarning && <InlineAlert variant="info">{cleanupWarning}</InlineAlert>}

      {imageSrc && (
        <AvatarCropper
          key={imageSrc}
          imageSrc={imageSrc}
          saving={status === "saving"}
          onSave={handleSave}
          onCancel={closeCropper}
        />
      )}
    </div>
  )
}

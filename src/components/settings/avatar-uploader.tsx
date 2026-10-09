"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import imageCompression from "browser-image-compression"
import { Button } from "@/components/ui/button"
import { UserAvatar } from "@/components/shared/user-avatar"
import { AvatarCropper } from "@/components/settings/avatar-cropper"
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

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path)

      const freshUrl = `${publicUrl}?t=${Date.now()}`

      const res = await fetch("/api/update-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: freshUrl }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Failed to save avatar")
        setStatus("error")
        return
      }

      setPreview(freshUrl)
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
      const supabase = createClient()
      const path = `${userId}/avatar.webp`

      // Best-effort delete from Storage — if it's already gone, that's fine.
      await supabase.storage.from("avatars").remove([path])

      const res = await fetch("/api/update-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error ?? "Failed to remove avatar")
        setStatus("error")
        return
      }

      setPreview(null)
      setStatus("idle")
      router.refresh()
    } catch {
      setError("Something went wrong removing the photo.")
      setStatus("error")
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center gap-4">
        <UserAvatar name={userName} src={preview} size="lg" />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => fileInput.current?.click()}>
            {preview ? "Change photo" : "Choose photo"}
          </Button>
          {preview && (
            <Button
              variant="ghost"
              disabled={status === "removing"}
              onClick={handleRemove}
              className="text-muted-foreground hover:text-destructive"
            >
              {status === "removing" ? "Removing…" : "Remove"}
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Square crop, under 2MB. We shrink it to under 500KB before uploading.
      </p>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {imageSrc && (
        <AvatarCropper
          imageSrc={imageSrc}
          saving={status === "saving"}
          onSave={handleSave}
          onCancel={closeCropper}
        />
      )}
    </div>
  )
}

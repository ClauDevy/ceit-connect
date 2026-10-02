"use client";

import { useState, useCallback } from "react";
import Cropper from "react-easy-crop";
import imageCompression from "browser-image-compression";
import { createClient } from "@/lib/supabase/client";

type Area = { x: number; y: number; width: number; height: number };

async function getCroppedBlob(imageSrc: string, cropPixels: Area): Promise<Blob> {
  const image = new Image();
  image.src = imageSrc;
  await new Promise((resolve) => (image.onload = resolve));

  const canvas = document.createElement("canvas");
  canvas.width = cropPixels.width;
  canvas.height = cropPixels.height;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(
    image,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    cropPixels.width,
    cropPixels.height
  );

  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), "image/webp", 0.9);
  });
}

export function AvatarUploader({
  userId,
  currentAvatarUrl,
}: {
  userId: string;
  currentAvatarUrl: string | null;
}) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedPixels, setCroppedPixels] = useState<Area | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "removing" | "error">(
    "idle"
  );
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(currentAvatarUrl);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setError("Image must be under 2MB.");
      return;
    }

    setError("");
    setImageSrc(URL.createObjectURL(file));
  }

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedPixels(pixels);
  }, []);

  async function handleSave() {
    if (!imageSrc || !croppedPixels) return;
    setStatus("saving");
    setError("");

    try {
      const croppedBlob = await getCroppedBlob(imageSrc, croppedPixels);
      const croppedFile = new File([croppedBlob], "avatar.webp", {
        type: "image/webp",
      });

      const compressedFile = await imageCompression(croppedFile, {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 512,
        fileType: "image/webp",
      });

      const supabase = createClient();
      const path = `${userId}/avatar.webp`;

      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, compressedFile, { upsert: true, contentType: "image/webp" });

      if (uploadError) {
        setError(uploadError.message);
        setStatus("error");
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);

      const freshUrl = `${publicUrl}?t=${Date.now()}`;

      const res = await fetch("/api/update-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: freshUrl }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to save avatar");
        setStatus("error");
        return;
      }

      setPreview(freshUrl);
      setImageSrc(null);
      setStatus("idle");
    } catch {
      setError("Something went wrong processing the image.");
      setStatus("error");
    }
  }

  async function handleRemove() {
    setStatus("removing");
    setError("");

    try {
      const supabase = createClient();
      const path = `${userId}/avatar.webp`;

      // Best-effort delete from Storage — if it's already gone, that's fine.
      await supabase.storage.from("avatars").remove([path]);

      const res = await fetch("/api/update-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: null }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Failed to remove avatar");
        setStatus("error");
        return;
      }

      setPreview(null);
      setStatus("idle");
    } catch {
      setError("Something went wrong removing the photo.");
      setStatus("error");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-full bg-muted">
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Avatar" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex flex-col gap-2">
          <label className="cursor-pointer rounded-xl border bg-background px-3.5 py-2 text-center text-sm font-semibold hover:bg-secondary">
            Choose Photo
            <input
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              className="hidden"
            />
          </label>
          {preview && (
            <button
              onClick={handleRemove}
              disabled={status === "removing"}
              className="text-xs font-medium text-muted-foreground underline hover:text-destructive disabled:opacity-50"
            >
              {status === "removing" ? "Removing..." : "Remove Photo"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {imageSrc && (
        <div className="flex flex-col gap-3">
          <div className="relative h-64 w-full overflow-hidden rounded-xl bg-black">
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
          <input
            type="range"
            min={1}
            max={3}
            step={0.1}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={status === "saving"}
              className="rounded-xl bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-accent-foreground disabled:opacity-50"
            >
              {status === "saving" ? "Saving..." : "Save Photo"}
            </button>
            <button
              onClick={() => setImageSrc(null)}
              className="rounded-xl border px-3.5 py-2 text-sm font-semibold hover:bg-secondary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
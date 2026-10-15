"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { getInitials } from "@/lib/format"

const SIZES = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-16 text-xl",
} as const

type UserAvatarProps = {
  name: string
  src?: string | null
  size?: keyof typeof SIZES
  className?: string
}

// Photo when we have one, otherwise a coloured circle with initials — also
// what everyone sees after a roster deactivation wipes the stored photo.
export function UserAvatar({ name, src, size = "md", className }: UserAvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = Boolean(src && src !== failedSrc)

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary font-display font-semibold text-primary-foreground",
        SIZES[size],
        className
      )}
    >
      {showImage ? (
        // Avatars come from Supabase Storage, already compressed client-side.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src ?? undefined}
          alt={name}
          className="size-full object-cover"
          onError={() => setFailedSrc(src ?? null)}
        />
      ) : (
        <span role="img" aria-label={name}>{getInitials(name)}</span>
      )}
    </span>
  )
}

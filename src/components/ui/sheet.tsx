"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { cn } from "@/lib/utils"

const Sheet = DialogPrimitive.Root
const SheetClose = DialogPrimitive.Close

function SheetContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-[var(--motion-enter-duration)] ease-[var(--motion-enter-easing)] data-[ending-style]:duration-[var(--motion-exit-duration)] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[starting-style]:opacity-100" />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t bg-popover p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl outline-none transition-transform duration-[var(--motion-enter-duration)] ease-[var(--motion-enter-easing)] data-[ending-style]:duration-[var(--motion-exit-duration)] data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full motion-reduce:transition-none motion-reduce:data-[starting-style]:translate-y-0",
          className
        )}
        {...props}
      >
        <div aria-hidden className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-border" />
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function SheetTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn("sr-only", className)} {...props} />
}

function SheetDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle }

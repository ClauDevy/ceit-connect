"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"
import { cn } from "@/lib/utils"

const AlertDialog = AlertDialogPrimitive.Root

function AlertDialogContent({ className, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-[var(--motion-enter-duration)] ease-[var(--motion-enter-easing)] data-[ending-style]:duration-[var(--motion-exit-duration)] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[starting-style]:opacity-100" />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 gap-5 rounded-2xl border bg-popover p-5 text-popover-foreground shadow-xl outline-none transition-[opacity,scale] duration-[var(--motion-enter-duration)] ease-[var(--motion-enter-easing)] data-[ending-style]:duration-[var(--motion-exit-duration)] data-[ending-style]:scale-[0.94] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.94] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[starting-style]:opacity-100 sm:p-6",
          className
        )}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      className={cn("font-display text-lg font-semibold", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
}

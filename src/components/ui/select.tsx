"use client"

import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

const Select = SelectPrimitive.Root

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        "flex h-10 min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-card px-3.5 text-left text-sm outline-none transition-[color,box-shadow,border-color] duration-[var(--motion-interaction-duration)] ease-[var(--motion-enter-easing)] hover:border-primary/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 data-[placeholder]:text-muted-foreground motion-reduce:transition-none md:min-h-0 dark:bg-input/30",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon className="text-muted-foreground">
        <ChevronDown className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectValue(props: SelectPrimitive.Value.Props) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectContent({ className, children, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={6} alignItemWithTrigger={false} className="z-50">
        <SelectPrimitive.Popup
          data-slot="select-content"
          className={cn(
            "max-h-72 min-w-[var(--anchor-width)] overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg outline-none transition-[opacity,scale] duration-[var(--motion-enter-duration)] ease-[var(--motion-enter-easing)] data-[ending-style]:scale-[0.94] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.94] data-[starting-style]:opacity-0 motion-reduce:transition-none motion-reduce:data-[starting-style]:scale-100 motion-reduce:data-[starting-style]:opacity-100",
            className
          )}
          {...props}
        >
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "flex min-h-11 cursor-default items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[highlighted]:bg-muted data-[highlighted]:text-accent-foreground data-[disabled]:opacity-50 md:min-h-0",
        className
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator>
        <Check className="size-4 text-primary" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  )
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem }

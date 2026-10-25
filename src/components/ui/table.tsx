import * as React from "react"
import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    // overscroll-x-contain: reaching the end of the table must not scroll the page behind it.
    <div data-slot="table-container" className="w-full max-w-full overflow-x-auto overscroll-x-contain">
      <table data-slot="table" className={cn("w-full min-w-[40rem] text-sm", className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("border-b bg-muted/60", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn("border-b transition-colors duration-150 hover:bg-primary/5 motion-reduce:transition-none", className)} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return <th data-slot="table-head" className={cn("px-4 py-3 text-left text-xs font-semibold text-muted-foreground", className)} {...props} />
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return <td data-slot="table-cell" className={cn("px-4 py-3 align-middle", className)} {...props} />
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }

import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// Standard shadcn helper: merges conditional classes and lets later Tailwind
// utilities win (e.g. `px-0` overriding a component's default `px-3`).
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

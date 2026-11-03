import { CalendarRange, HandHelping, ListChecks, Users } from "lucide-react"
import { TigerMascot } from "@/components/ui/tiger-mascot"

const HIGHLIGHTS = [
  { icon: ListChecks, label: "Tasks" },
  { icon: CalendarRange, label: "Timelines" },
  { icon: HandHelping, label: "Teamwork" },
] as const

// Brand panel for tablet/desktop. Phones skip it entirely (AuthShell shows a
// compact mascot + name instead) so sign-in fits on a single screen.
// Soft council-wash in light mode, card surface in dark: orange stays an
// accent, not the whole background.
export function LoginHero() {
  return (
    <section className="relative hidden flex-col items-center justify-center overflow-hidden border-r bg-muted px-10 py-10 text-center md:flex md:w-[42%] md:shrink-0 dark:bg-card">
      <div className="flex max-w-sm flex-col items-center">
        <div
          role="img"
          aria-label="CEIT Connect tiger mascot"
          className="relative mb-8 grid place-items-center"
        >
          <span aria-hidden className="brand-shield-art absolute h-80 w-70 -translate-y-6" />
          <TigerMascot size={200} mark className="relative" />
        </div>

        <span className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-semibold tracking-wide text-accent-foreground uppercase">
          <Users className="size-3.5" aria-hidden />
          CEIT Student Council
        </span>
        <p className="font-display text-4xl font-semibold tracking-tight">CEIT Connect</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The official workspace of the College of Engineering and Information Technology Student
          Council, Cavite State University.
        </p>

        <ul className="mt-6 flex flex-wrap justify-center gap-2">
          {HIGHLIGHTS.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-secondary-foreground dark:bg-background/40"
            >
              <Icon className="size-3.5 text-primary" aria-hidden />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

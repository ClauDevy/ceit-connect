import { TigerMascot } from "@/components/ui/tiger-mascot"

// Brand panel for tablet/desktop. Phones skip it entirely (AuthShell shows a
// compact mascot instead) so sign-in fits on a single screen.
// Soft council-wash in light mode, card surface in dark: orange stays an
// accent, not the whole background.
export function LoginHero() {
  return (
    <section className="relative hidden flex-col items-center justify-center overflow-hidden border-r bg-muted px-8 py-10 text-center md:flex md:w-[42%] md:shrink-0 dark:bg-card">
      <div className="flex max-w-sm flex-col items-center">
        <div className="relative mb-8 grid place-items-center">
          <div aria-hidden className="absolute size-60 rounded-full bg-accent/70 dark:bg-primary/10" />
          <TigerMascot size={200} className="relative" />
        </div>

        <p className="font-display text-2xl font-semibold tracking-tight">CEIT Connect</p>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          One workspace for every committee: tasks, timelines, and confidential
          council business, all in one place.
        </p>
      </div>
    </section>
  )
}

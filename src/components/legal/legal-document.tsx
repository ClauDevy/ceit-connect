import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, ChevronDown, Mail, MapPin, MessageCircle } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { LegalFloatingNav } from "@/components/legal/legal-floating-nav"
import { Mascot } from "@/components/ui/mascot"
import { TigerLogo } from "@/components/ui/tiger-logo"
import { COUNCIL_CONTACT, LEGAL_EFFECTIVE_DATE, LEGAL_VERSION } from "@/lib/council-info"
import { cn } from "@/lib/utils"

export type LegalSection = {
  id: string
  title: string
  content: ReactNode
}

/** Normal paragraph inside a legal section. */
export function LegalP({ children }: { children: ReactNode }) {
  return <p>{children}</p>
}

/** Bulleted list with brand-coloured dots. */
export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-primary" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** Quiet highlighted note for something readers should not miss. */
export function LegalNote({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-primary/25 bg-primary/8 px-4 py-3 text-[15px] leading-6 text-foreground">
      {children}
    </p>
  )
}

function ContactCard() {
  const rows = [
    {
      icon: Mail,
      label: "Email",
      value: COUNCIL_CONTACT.email,
      href: `mailto:${COUNCIL_CONTACT.email}`,
    },
    {
      icon: MessageCircle,
      label: "Facebook",
      value: "Message our Facebook page",
      href: COUNCIL_CONTACT.facebookUrl,
    },
    {
      icon: MapPin,
      label: "Visit us",
      value: COUNCIL_CONTACT.office,
      href: null,
    },
  ] as const
  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {rows.map(({ icon: Icon, label, value, href }) => {
        const inner = (
          <>
            <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
              <Icon className="size-5" />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
              <span className="mt-0.5 block text-sm font-medium break-words text-foreground">{value}</span>
            </span>
          </>
        )
        const base = "flex items-start gap-3 rounded-2xl border bg-card p-3.5"
        return (
          <li key={label} className="min-w-0">
            {href ? (
              <a
                href={href}
                {...(href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                className={cn(base, "outline-none transition-colors hover:border-primary/45 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none")}
              >
                {inner}
              </a>
            ) : (
              <div className={base}>{inner}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Shared layout for the public Terms of Service and Privacy Policy pages: friendly header,
 * "short version" summary, table of contents, numbered sections, contact card.
 * Server component, no client JS: the contents list uses plain anchor links and a native
 * <details> on phones.
 */
export function LegalDocument({
  title,
  icon,
  intro,
  summary,
  sections,
  signedIn,
  other,
}: {
  title: string
  icon: ReactNode
  intro: string
  summary: string[]
  sections: LegalSection[]
  signedIn: boolean
  other: { href: string; label: string }
}) {
  const toc = (
    <ol className="space-y-0.5 text-sm">
      {sections.map((section, index) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none lg:min-h-0"
          >
            <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-primary">{index + 1}</span>
            <span className="min-w-0">{section.title}</span>
          </a>
        </li>
      ))}
    </ol>
  )

  return (
    <div className="min-h-svh">
      <LegalFloatingNav />
      <header className="border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            href={signedIn ? "/home" : "/login"}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg pr-2 font-display font-bold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <TigerLogo size={32} />
            CEIT Connect
          </Link>
          <Link
            href={signedIn ? "/home" : "/login"}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft aria-hidden />
            {signedIn ? "Back to home" : "Back to sign in"}
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <section className="flex items-center justify-between gap-6">
          <div className="min-w-0">
            <span aria-hidden className="mb-4 grid size-12 place-items-center rounded-2xl bg-primary/12 text-primary [&_svg]:size-6">
              {icon}
            </span>
            <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-muted-foreground">{intro}</p>
            <p className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
              <span className="rounded-full border bg-card px-3 py-1">Effective {LEGAL_EFFECTIVE_DATE}</span>
              <span className="rounded-full border bg-card px-3 py-1">Version {LEGAL_VERSION}</span>
            </p>
          </div>
          <div className="hidden shrink-0 sm:block">
            <Mascot pose="waving" size={132} />
          </div>
        </section>

        <aside
          aria-labelledby="short-version"
          className="mt-8 rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 to-transparent p-5 sm:p-6"
        >
          <h2 id="short-version" className="font-display text-lg font-semibold">The short version</h2>
          <ul className="mt-3 grid gap-2.5 text-[15px] leading-6 sm:grid-cols-2">
            {summary.map((point) => (
              <li key={point} className="flex gap-3">
                <span aria-hidden className="mt-[0.6em] size-1.5 shrink-0 rounded-full bg-primary" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            This summary is a convenience. The full text below is what applies.
          </p>
        </aside>

        <div className="mt-8 grid gap-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
          <nav id="legal-contents" aria-label={`${title} contents`} className="scroll-mt-4 lg:sticky lg:top-6 lg:self-start">
            <details className="group rounded-2xl border bg-card lg:hidden">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-4 py-2 text-sm font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                On this page
                <ChevronDown aria-hidden className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
              </summary>
              <div className="border-t p-2">{toc}</div>
            </details>
            <div className="hidden lg:block">
              <p className="mb-2 px-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
              {toc}
            </div>
          </nav>

          <article className="min-w-0 space-y-10">
            {sections.map((section, index) => (
              <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="scroll-mt-6">
                <h2 id={`${section.id}-heading`} className="flex items-baseline gap-3 font-display text-xl font-semibold sm:text-2xl">
                  <span aria-hidden className="text-base font-bold text-primary tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                  {section.title}
                </h2>
                <div className="mt-3 max-w-2xl space-y-3 text-[15px] leading-7 text-foreground/90 sm:text-base sm:leading-7">
                  {section.content}
                </div>
              </section>
            ))}

            <section id="contact" aria-labelledby="contact-heading" className="scroll-mt-6 border-t pt-8">
              <h2 id="contact-heading" className="font-display text-xl font-semibold sm:text-2xl">Questions? Talk to us</h2>
              <p className="mt-2 mb-4 max-w-2xl text-[15px] leading-7 text-muted-foreground">
                {COUNCIL_CONTACT.organization}, {COUNCIL_CONTACT.institution}. We are happy to explain anything on this page.
              </p>
              <ContactCard />
            </section>

            <footer className="flex flex-col gap-3 border-t pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <Link
                href={other.href}
                className="inline-flex min-h-11 items-center rounded-md underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0"
              >
                Also read: {other.label}
              </Link>
              <p>© 2026 {COUNCIL_CONTACT.organization}, {COUNCIL_CONTACT.institution}.</p>
            </footer>
          </article>
        </div>
      </main>
    </div>
  )
}

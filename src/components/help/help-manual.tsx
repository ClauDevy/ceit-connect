"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  ArrowUp,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  CircleQuestionMark,
  Clock,
  Headset,
  Lightbulb,
  LayoutGrid,
  LifeBuoy,
  ListChecks,
  Mail,
  MapPin,
  MessageCircle,
  Rocket,
  Search,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { HelpIllustration } from "@/components/help/help-illustrations";
import { EmptyState } from "@/components/shared/empty-state";
import { Collapse, SectionEnter } from "@/components/shared/motion";
import { Card } from "@/components/ui/card";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TigerMascot } from "@/components/ui/tiger-mascot";
import { cn } from "@/lib/utils";
import type {
  HelpContact,
  HelpManualBlock,
  HelpManualFaq,
  HelpManualPayload,
} from "@/lib/help-manual";

type SectionId = string;

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

const SECTION_ICONS: Record<string, LucideIcon> = {
  "quick-start": Rocket,
  words: BookOpen,
  "your-tasks": ListChecks,
  events: CalendarDays,
  notifications: Bell,
  leadership: ShieldCheck,
  faq: LifeBuoy,
  contact: Headset,
};

const SEARCH_SUGGESTIONS = ["Forgot password", "Install the app", "Turn on notifications", "Leave a task"];

/** Turns **bold** markers in the copy into real bold text. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <strong key={index} className="font-semibold text-foreground">
            {part}
          </strong>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** A stable id for one block of a guide, so a search result can jump straight to it. */
const blockAnchor = (sectionId: string, heading: string) =>
  `${sectionId}--${heading.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

const plain = (text: string) => text.replace(/\*\*/g, "");

/** The red "Clear" pill, so it is easy to spot while you are searching. */
const clearButtonClass = (extra = "") =>
  cn(
    "inline-flex items-center gap-1.5 rounded-xl bg-destructive/10 px-3 text-sm font-semibold text-destructive outline-none ring-1 ring-destructive/30 transition-colors hover:bg-destructive hover:text-white focus-visible:ring-2 focus-visible:ring-destructive motion-reduce:transition-none dark:hover:text-background",
    extra,
  );

function searchWords(query: string) {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

function matchesAll(words: readonly string[], haystack: string) {
  const text = haystack.toLocaleLowerCase();
  return words.every((word) => text.includes(word));
}

function faqText(faq: HelpManualFaq) {
  return plain([faq.question, ...faq.answer].join(" "));
}

function blockText(block: HelpManualBlock) {
  return plain(
    [
      block.heading,
      ...(block.paragraphs ?? []),
      ...(block.bullets ?? []),
      ...(block.steps ?? []),
      ...(block.glossary ?? []).map((item) => `${item.term} ${item.meaning}`),
      block.tip ?? "",
    ].join(" "),
  );
}

/** The sentence that best explains why a guide matched. */
function snippetFor(text: string, words: readonly string[]) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((sentence) => matchesAll(words.slice(0, 1), sentence)) ?? sentences[0] ?? "";
  return hit.length > 150 ? `${hit.slice(0, 147).trimEnd()}…` : hit;
}

/* -------------------------------------------------------------------------- */
/* Content blocks                                                             */
/* -------------------------------------------------------------------------- */

const bodyText = "text-base leading-7 text-foreground/85 md:text-[17px] md:leading-8";

function Callout({ children }: { children: string }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-primary/30 bg-accent/35 p-4 sm:p-5">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary" aria-hidden>
        <Lightbulb className="size-5" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="font-display text-sm font-semibold tracking-wide text-accent-foreground uppercase">Good to know</p>
        <p className={bodyText}>
          <RichText text={children} />
        </p>
      </div>
    </div>
  );
}

function ManualBlocks({
  sectionId,
  variant,
  blocks,
}: {
  sectionId: string;
  variant: "mobile" | "desktop";
  blocks: readonly HelpManualBlock[];
}) {
  return (
    <div className="space-y-10">
      {blocks.map((block) => (
        <div key={block.heading} className="space-y-4">
          <h3
            id={`${blockAnchor(sectionId, block.heading)}-${variant === "mobile" ? "m" : "d"}`}
            tabIndex={-1}
            className="flex scroll-mt-24 items-center gap-3 font-display text-xl font-semibold text-foreground outline-none md:text-[22px]"
          >
            <span aria-hidden className="h-7 w-1.5 shrink-0 rounded-full bg-primary" />
            {block.heading}
          </h3>

          {block.paragraphs?.map((paragraph) => (
            <p key={paragraph} className={bodyText}>
              <RichText text={paragraph} />
            </p>
          ))}

          {block.illustration ? <HelpIllustration id={block.illustration} /> : null}

          {block.glossary?.length ? (
            <dl className="grid gap-3 sm:grid-cols-2">
              {block.glossary.map((item) => (
                <div key={item.term} className="rounded-2xl border bg-muted/40 p-4">
                  <dt className="flex items-center gap-2 font-display text-lg font-semibold text-foreground">
                    <span aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />
                    {item.term}
                  </dt>
                  <dd className="mt-1 text-base leading-7 text-foreground/80">{item.meaning}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {block.steps?.length ? (
            <ol className="space-y-3">
              {block.steps.map((step, index) => (
                <li key={step} className="flex items-start gap-4 rounded-2xl border bg-card p-4">
                  <span
                    aria-hidden
                    className="grid size-9 shrink-0 place-items-center rounded-full bg-primary font-display text-lg font-semibold text-primary-foreground"
                  >
                    {index + 1}
                  </span>
                  <span className={cn(bodyText, "pt-0.5")}>
                    <RichText text={step} />
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {block.bullets?.length ? (
            <ul className="space-y-2.5">
              {block.bullets.map((bullet) => (
                <li key={bullet} className="flex items-start gap-3 rounded-2xl bg-muted/50 px-4 py-3.5">
                  <CircleCheck className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
                  <span className={bodyText}>
                    <RichText text={bullet} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {block.tip ? <Callout>{block.tip}</Callout> : null}
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* FAQ                                                                        */
/* -------------------------------------------------------------------------- */

function FaqList({
  faqs,
  expanded,
  onToggle,
  idSuffix,
}: {
  faqs: readonly HelpManualFaq[];
  expanded: ReadonlySet<string>;
  onToggle: (id: string) => void;
  idSuffix: string;
}) {
  return (
    <div className="space-y-3">
      {faqs.map((faq) => {
        const isOpen = expanded.has(faq.id);
        const panelId = `faq-${faq.id}-${idSuffix}`;
        return (
          <div
            key={faq.id}
            className={cn(
              "overflow-hidden rounded-2xl border bg-card transition-colors duration-[var(--motion-interaction-duration)] motion-reduce:transition-none",
              isOpen && "border-primary/45 bg-primary/[0.04]",
            )}
          >
            <button
              type="button"
              className="flex min-h-16 w-full items-center gap-3 px-4 py-3.5 text-left text-base font-semibold outline-none transition-colors duration-[var(--motion-interaction-duration)] hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset motion-reduce:transition-none md:px-5 md:text-[17px]"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => onToggle(faq.id)}
            >
              <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <CircleQuestionMark className="size-5" />
              </span>
              <span className="min-w-0 flex-1">{faq.question}</span>
              <ChevronDown
                className={cn(
                  "size-5 shrink-0 text-muted-foreground transition-transform duration-[var(--motion-panel-duration)] motion-reduce:transition-none",
                  isOpen && "rotate-180 text-primary",
                )}
                aria-hidden
              />
            </button>
            <Collapse open={isOpen}>
              <div id={panelId} className="space-y-2 border-t px-4 py-4 md:px-5 md:pl-[4.25rem]">
                {faq.answer.map((paragraph) => (
                  <p key={paragraph} className={bodyText}>
                    <RichText text={paragraph} />
                  </p>
                ))}
              </div>
            </Collapse>
          </div>
        );
      })}
    </div>
  );
}

const CONTACT_ICONS = {
  email: Mail,
  messenger: MessageCircle,
  hours: Clock,
  office: MapPin,
} as const;

function ContactPanel({ contact }: { contact: HelpContact }) {
  return (
    <div className="space-y-6">
      <p className={bodyText}>{contact.summary}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {contact.channels.map((channel) => {
          const Icon = CONTACT_ICONS[channel.id];
          return (
            <li key={channel.id} className="flex items-start gap-4 rounded-2xl border bg-card p-4">
              <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary">
                <Icon className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="font-display text-lg font-semibold">{channel.label}</p>
                <p className="mt-0.5 text-base font-medium break-words text-foreground">{channel.value}</p>
                <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{channel.note}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <Callout>{contact.tip}</Callout>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* One section card (accordion on phones, always open on larger screens)      */
/* -------------------------------------------------------------------------- */

function SectionShell({
  id,
  title,
  summary,
  icon: Icon,
  number,
  open,
  onToggle,
  next,
  onNext,
  onTop,
  dashed = false,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  icon: LucideIcon;
  number?: number;
  open: boolean;
  onToggle: () => void;
  next?: { id: string; label: string };
  onNext: (id: string) => void;
  onTop: () => void;
  dashed?: boolean;
  children: (variant: "mobile" | "desktop") => ReactNode;
}) {
  const panelId = `${id}-mobile-panel`;

  const badge = (
    <span
      aria-hidden
      className="relative grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary sm:size-14"
    >
      <Icon className="size-6 sm:size-7" />
      {number ? (
        <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-primary font-display text-xs font-semibold text-primary-foreground ring-2 ring-card">
          {number}
        </span>
      ) : null}
    </span>
  );

  const footer = (
    <div
      className={cn(
        "flex flex-col gap-2 border-t bg-muted/30 p-3 sm:px-6 md:flex-row md:items-center md:justify-between md:py-2.5",
        !next && "max-md:hidden",
      )}
    >
      <button
        type="button"
        onClick={onTop}
        className="hidden min-h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none md:inline-flex"
      >
        <ArrowUp className="size-4" aria-hidden /> Back to top
      </button>
      {next ? (
        <a
          href={`#${next.id}`}
          onClick={(event) => {
            event.preventDefault();
            onNext(next.id);
          }}
          className="group flex min-h-12 w-full items-center justify-between gap-2 rounded-xl bg-primary/10 px-4 text-base font-semibold text-accent-foreground outline-none transition-colors hover:bg-primary/20 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none md:inline-flex md:min-h-9 md:w-auto md:justify-start md:text-sm dark:text-foreground"
        >
          <span>Next: {next.label}</span>
          <ArrowRight className="motion-arrow size-4 shrink-0" aria-hidden />
        </a>
      ) : null}
    </div>
  );

  return (
    <SectionEnter as="section" id={id} tabIndex={-1} className="scroll-mt-24 outline-none" aria-label={title}>
      <Card dashed={dashed} className="overflow-hidden">
        <div className="border-b bg-linear-to-r from-primary/[0.09] via-primary/[0.03] to-transparent">
          <h2 className="md:hidden">
            <button
              type="button"
              className="flex min-h-20 w-full items-center gap-4 p-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={onToggle}
            >
              {badge}
              <span className="min-w-0 flex-1">
                <span className="block font-display text-xl leading-tight font-semibold">{title}</span>
                <span className="mt-1 block text-[15px] leading-6 font-normal text-muted-foreground">{summary}</span>
              </span>
              <span
                aria-hidden
                className={cn(
                  "grid size-9 shrink-0 place-items-center rounded-full bg-card text-muted-foreground ring-1 ring-border transition-transform duration-[var(--motion-panel-duration)] motion-reduce:transition-none",
                  open && "rotate-180 text-primary",
                )}
              >
                <ChevronDown className="size-5" />
              </span>
            </button>
          </h2>
          <div className="hidden items-center gap-5 p-6 md:flex">
            {badge}
            <div className="min-w-0">
              <h2 id={`${id}-desktop-title`} className="font-display text-2xl leading-tight font-semibold">
                {title}
              </h2>
              <p className="mt-1 text-[17px] leading-7 text-muted-foreground">{summary}</p>
            </div>
          </div>
        </div>

        <div className="md:hidden">
          <Collapse open={open}>
            <div id={panelId}>
              <div className="p-4 pt-6 sm:p-6">{children("mobile")}</div>
              {footer}
            </div>
          </Collapse>
        </div>
        <div className="hidden md:block">
          <div className="p-6 pt-8">{children("desktop")}</div>
          {footer}
        </div>
      </Card>
    </SectionEnter>
  );
}

/* -------------------------------------------------------------------------- */
/* The whole Help page                                                        */
/* -------------------------------------------------------------------------- */

export function HelpManual({ manual }: { manual: HelpManualPayload }) {
  const [openSections, setOpenSections] = useState<Set<SectionId>>(() => new Set(["quick-start"]));
  const [expandedFaqs, setExpandedFaqs] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [nearTop, setNearTop] = useState(true);
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const pendingScroll = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);

  const words = useMemo(() => searchWords(query), [query]);

  const faqHits = useMemo(
    () => (words.length ? manual.faqs.filter((faq) => matchesAll(words, faqText(faq))) : []),
    [manual.faqs, words],
  );

  const guideHits = useMemo(() => {
    if (!words.length) return [];
    return manual.sections
      .flatMap((section) =>
        section.blocks.map((block) => ({ section, block, text: blockText(block) })),
      )
      .filter(({ section, text }) => matchesAll(words, `${section.title} ${text}`))
      .slice(0, 6)
      .map(({ section, block, text }) => ({
        key: `${section.id}-${block.heading}`,
        sectionId: section.id,
        anchor: blockAnchor(section.id, block.heading),
        sectionTitle: section.title,
        heading: block.heading,
        snippet: snippetFor(text, words),
      }));
  }, [manual.sections, words]);

  const jumpItems = useMemo(
    () => [
      ...manual.sections.map((section) => ({
        id: section.id,
        label: section.title,
        blurb: section.blurb,
      })),
      { id: "faq", label: "FAQ & troubleshooting", blurb: "Quick answers to common questions" },
      { id: "contact", label: "Contact us", blurb: "Reach a real person" },
    ],
    [manual.sections],
  );

  const tiles = jumpItems;

  useEffect(() => {
    const targetId = pendingScroll.current;
    if (!targetId) return;
    // Block headings exist twice (phone copy and desktop copy); use the one on screen.
    const candidates = [targetId, `${targetId}-m`, `${targetId}-d`]
      .map((candidateId) => document.getElementById(candidateId))
      .filter((element): element is HTMLElement => element !== null);
    const target = candidates.find((element) => element.getClientRects().length > 0) ?? candidates[0];
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    pendingScroll.current = null;
    if (pendingFocus.current === targetId) {
      target.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [openSections, scrollRequest]);

  // Highlights the section you are reading in the side menu.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = jumpItems.map((item) => item.id);
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const current = ids.find((id) => visible.has(id));
        if (current) setActiveId(current);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, [jumpItems]);

  // The phone's floating buttons only appear once the top of the page is out of view.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const ids = ["help-top", "topics"];
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      }
      setNearTop(visible.size > 0);
    });
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
  }, []);

  function requestScroll(id: string) {
    pendingScroll.current = id;
    setScrollRequest((current) => current + 1);
  }

  function openThenScroll(id: string) {
    setOpenSections((current) => new Set(current).add(id));
    pendingFocus.current = id;
    requestScroll(id);
  }

  function toggleSection(id: string) {
    setOpenSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleFaq(id: string) {
    setExpandedFaqs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function changeQuery(value: string) {
    setQuery(value);
    const needle = searchWords(value);
    if (!needle.length) return;
    const firstMatch = manual.faqs.find((faq) => matchesAll(needle, faqText(faq)));
    if (firstMatch) setExpandedFaqs((current) => new Set(current).add(firstMatch.id));
  }

  /** Opens the section, then scrolls to and focuses the exact block. The search stays as it was. */
  function goToBlock(sectionId: string, anchor: string) {
    const wasOpen = openSections.has(sectionId);
    setOpenSections((current) => new Set(current).add(sectionId));
    pendingFocus.current = anchor;
    if (wasOpen) requestScroll(anchor);
    // A closed phone section needs a moment to unfold before its position is known.
    else window.setTimeout(() => requestScroll(anchor), 350);
  }

  const searching = words.length > 0;
  const hasResults = faqHits.length > 0 || guideHits.length > 0;
  const tileRemainder = tiles.length % 3;

  const sectionTotal = manual.sections.length;
  const nextOf = (index: number) => {
    const target = jumpItems[index + 1];
    return target ? { id: target.id, label: target.label } : undefined;
  };

  return (
    <div className="space-y-8 md:space-y-10">
      {/* ------------------------------ Hero ------------------------------ */}
      <section
        id="help-top"
        aria-labelledby="help-title"
        className="relative scroll-mt-24 overflow-hidden rounded-3xl border bg-linear-to-br from-primary/[0.16] via-accent/40 to-card p-5 sm:p-8 lg:p-10"
      >
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-16 size-64 rounded-full bg-primary/15 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-24 left-1/3 size-56 rounded-full bg-accent/60 blur-3xl" />

        <div className="relative grid grid-cols-[minmax(0,1fr)] items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto] md:gap-10">
          <div className="min-w-0">
            <div className="flex items-center gap-3 md:hidden">
              <TigerMascot size={96} className="w-20 shrink-0 sm:w-24 [&_svg]:h-auto [&_svg]:w-full" />
              <div
                aria-hidden
                className="relative rounded-2xl border bg-card px-4 py-2.5 font-display text-base leading-snug font-semibold shadow-sm"
              >
                Hi there! Need a hand?
                <span className="absolute top-1/2 -left-1.5 size-3 -translate-y-1/2 rotate-45 border-b border-l bg-card" />
              </div>
            </div>
            <span className="hidden items-center gap-2 rounded-full border bg-card/80 px-3 py-1.5 text-sm font-semibold text-accent-foreground backdrop-blur-sm md:inline-flex dark:text-foreground">
              <LifeBuoy className="size-4 text-primary" aria-hidden />
              Help Center
            </span>

            <h1
              id="help-title"
              className="mt-4 font-display text-3xl leading-tight font-semibold tracking-tight sm:text-4xl md:mt-5 lg:text-5xl"
            >
              How can we help you today?
            </h1>
            <p className="mt-3 max-w-xl text-base leading-7 text-foreground/80 sm:text-lg sm:leading-8">
              Simple, step-by-step answers about CEIT Connect, shown for your role ({manual.viewerRole}). Type a question, or pick a topic below.
            </p>

            <form role="search" className="mt-6" onSubmit={(event) => event.preventDefault()}>
              <label htmlFor="help-search" className="sr-only">
                Search the help center
              </label>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <input
                  id="help-search"
                  type="text"
                  inputMode="search"
                  enterKeyHint="search"
                  autoComplete="off"
                  value={query}
                  onChange={(event) => changeQuery(event.target.value)}
                  placeholder="Search for help…"
                  className={cn(
                    "h-14 w-full min-w-0 rounded-2xl border border-input bg-card pl-12 text-base text-foreground shadow-sm outline-none transition-[box-shadow,border-color] duration-[var(--motion-interaction-duration)] placeholder:text-muted-foreground hover:border-primary/60 focus-visible:border-ring focus-visible:ring-4 focus-visible:ring-ring/25 motion-reduce:transition-none sm:text-lg",
                    query ? "pr-28" : "pr-4",
                  )}
                />
                {query ? (
                  <button
                    type="button"
                    aria-label="Clear search"
                    onClick={() => changeQuery("")}
                    className={clearButtonClass("absolute top-1/2 right-2 h-10 -translate-y-1/2")}
                  >
                    <X className="size-4" aria-hidden /> Clear
                  </button>
                ) : null}
              </div>
              <p className="mt-4 mb-2 text-sm font-semibold text-muted-foreground">Popular searches</p>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden">
                {SEARCH_SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => changeQuery(suggestion)}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-full border bg-card/80 px-4 text-sm font-medium whitespace-nowrap outline-none transition-colors hover:border-primary/50 hover:bg-card focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none md:min-h-10"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </form>
          </div>

          <div aria-hidden className="hidden flex-col items-center md:flex">
            <div className="relative mb-2 rounded-2xl rounded-br-sm border bg-card px-4 py-2.5 font-display text-base font-semibold shadow-sm">
              Hi there! Need a hand?
              <span className="absolute -bottom-1.5 right-6 size-3 rotate-45 border-r border-b bg-card" />
            </div>
            <TigerMascot size={176} mark />
          </div>
        </div>
      </section>

      {/* --------------------------- Search results --------------------------- */}
      {searching ? (
        <section aria-labelledby="results-title" aria-live="polite" className="space-y-5">
          {hasResults ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <h2 id="results-title" className="font-display text-xl font-semibold md:text-2xl">
                  {faqHits.length + guideHits.length} {faqHits.length + guideHits.length === 1 ? "result" : "results"} for “{query.trim()}”
                </h2>
                <button type="button" onClick={() => changeQuery("")} className={clearButtonClass("min-h-11 shrink-0 md:min-h-10")}>
                  <X className="size-4" aria-hidden /> Clear search
                </button>
              </div>

              {faqHits.length ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">Answers</h3>
                  <FaqList faqs={faqHits} expanded={expandedFaqs} onToggle={toggleFaq} idSuffix="results" />
                </div>
              ) : null}

              {guideHits.length ? (
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">In the guides</h3>
                  <ul className="grid gap-3 md:grid-cols-2">
                    {guideHits.map((hit) => (
                      <li key={hit.key}>
                        <Card interactive tone="primary" className="h-full">
                          <a
                            href={`#${hit.anchor}`}
                            onClick={(event) => {
                              event.preventDefault();
                              goToBlock(hit.sectionId, hit.anchor);
                            }}
                            className="group flex h-full flex-col gap-1.5 rounded-2xl p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          >
                            <span className="text-sm font-medium text-muted-foreground">{hit.sectionTitle}</span>
                            <span className="flex items-center justify-between gap-2 font-display text-lg font-semibold">
                              {hit.heading}
                              <ArrowRight className="motion-arrow size-5 shrink-0 text-primary" aria-hidden />
                            </span>
                            <span className="text-base leading-6 text-foreground/75">{hit.snippet}</span>
                          </a>
                        </Card>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <div>
              <h2 id="results-title" className="sr-only">Search results</h2>
              <EmptyState
                pose="searching"
                title={`No results for “${query.trim()}”`}
                description="Try a shorter or simpler word, like “password” or “notification”."
                action={
                  <button type="button" onClick={() => changeQuery("")} className={clearButtonClass("min-h-11")}>
                    <X className="size-4" aria-hidden /> Clear search
                  </button>
                }
              />
            </div>
          )}
        </section>
      ) : null}

      {/* ----------------------------- Topic tiles ----------------------------- */}
      <section id="topics" aria-labelledby="topics-title" className="space-y-4">
        <div>
          <h2 id="topics-title" className="font-display text-2xl font-semibold md:text-3xl">
            Pick a topic
          </h2>
          <p className="mt-1 text-base text-muted-foreground md:text-lg">Tap one to jump straight to it.</p>
        </div>
        <nav aria-label="Help topics">
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-6 md:gap-4">
            {tiles.map((item, index) => {
              const Icon = SECTION_ICONS[item.id] ?? Sparkles;
              const wide = (index === tiles.length - 1 && tileRemainder === 1);
              return (
                <li
                  key={item.id}
                  className={cn(
                    "md:col-span-2",
                    index === tiles.length - 1 && tiles.length % 2 === 1 && "max-md:col-span-2",
                    index === tiles.length - 1 && tileRemainder === 1 && "md:col-span-6",
                    index >= tiles.length - 2 && tileRemainder === 2 && "md:col-span-3",
                  )}
                >
                  <Card interactive tone="primary" className="h-full">
                    <a
                      href={`#${item.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        openThenScroll(item.id);
                      }}
                      className={cn(
                        "group relative flex h-full gap-3 rounded-2xl p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:p-5",
                        wide ? "md:flex-row md:items-center" : "",
                        "flex-col",
                      )}
                    >
                      <span
                        aria-hidden
                        className="grid size-12 shrink-0 place-items-center rounded-2xl bg-primary/12 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground motion-reduce:transition-none md:size-14"
                      >
                        <Icon className="size-6 md:size-7" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-display text-lg leading-tight font-semibold md:text-xl">{item.label}</span>
                        <span className="mt-1 block text-[15px] leading-6 text-muted-foreground md:text-base">{item.blurb}</span>
                      </span>
                      <ArrowRight
                        className="motion-arrow absolute top-4 right-4 hidden size-5 text-primary md:top-5 md:right-5 md:block"
                        aria-hidden
                      />
                    </a>
                  </Card>
                </li>
              );
            })}
          </ul>
        </nav>
      </section>

      {/* --------------------- Side menu + all the guides --------------------- */}
      <div className="grid items-start gap-6 lg:grid-cols-[16.5rem_minmax(0,1fr)] lg:gap-8">
        <aside className="hidden lg:sticky lg:top-24 lg:block">
          <nav
            aria-label="Help sections"
            className="max-h-[calc(100dvh-7.5rem)] overflow-y-auto rounded-2xl border bg-card p-3"
          >
            <div className="flex items-center justify-between gap-2 px-3 pt-1 pb-2">
              <p className="font-display text-sm font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
              <button
                type="button"
                onClick={() => requestScroll("help-top")}
                aria-label="Back to top"
                title="Back to top"
                className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground outline-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
            </div>
            <ul className="space-y-0.5">
              {jumpItems.map((item) => {
                const Icon = SECTION_ICONS[item.id] ?? Sparkles;
                const active = activeId === item.id;
                return (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      aria-current={active ? "location" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] leading-snug font-medium outline-none transition-colors duration-[var(--motion-interaction-duration)] focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                        active
                          ? "bg-primary/12 font-semibold text-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      onClick={(event) => {
                        event.preventDefault();
                        openThenScroll(item.id);
                      }}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-lg transition-colors motion-reduce:transition-none",
                          active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                        )}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0">{item.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {manual.sections.map((section, index) => (
            <SectionShell
              key={section.id}
              id={section.id}
              title={section.title}
              summary={section.summary}
              icon={SECTION_ICONS[section.id] ?? Sparkles}
              number={index + 1}
              open={openSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
              next={nextOf(index)}
              onNext={openThenScroll}
              onTop={() => requestScroll("help-top")}
            >
              {(variant) => <ManualBlocks sectionId={section.id} variant={variant} blocks={section.blocks} />}
            </SectionShell>
          ))}

          <SectionShell
            id="faq"
            title="FAQ & troubleshooting"
            summary="Quick answers to the questions people ask most."
            icon={LifeBuoy}
            open={openSections.has("faq")}
            onToggle={() => toggleSection("faq")}
            next={nextOf(sectionTotal)}
            onNext={openThenScroll}
            onTop={() => requestScroll("help-top")}
          >
            {(variant) => (
              <FaqList faqs={manual.faqs} expanded={expandedFaqs} onToggle={toggleFaq} idSuffix={variant} />
            )}
          </SectionShell>

          <SectionShell
            id="contact"
            title="Contact us"
            summary="Still stuck? Reach a real person."
            icon={Headset}
            open={openSections.has("contact")}
            onToggle={() => toggleSection("contact")}
            onNext={openThenScroll}
            onTop={() => requestScroll("help-top")}
          >
            {() => <ContactPanel contact={manual.contact} />}
          </SectionShell>
        </div>
      </div>

      {/* Phone only: floating "Topics" and "Back to top" buttons, plus the topics sheet. */}
      {isClient && !nearTop
        ? createPortal(
            <div className="fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-3 md:hidden">
              <button
                type="button"
                onClick={() => requestScroll("help-top")}
                aria-label="Back to top"
                className="grid size-12 place-items-center rounded-full border bg-card text-foreground shadow-lg outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
              >
                <ArrowUp className="size-5" aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => setTopicsOpen(true)}
                aria-haspopup="dialog"
                className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-base font-semibold text-primary-foreground shadow-lg outline-none transition-colors hover:bg-primary/90 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
              >
                <LayoutGrid className="size-5" aria-hidden /> Topics
              </button>
            </div>,
            document.body,
          )
        : null}

      <Sheet open={topicsOpen} onOpenChange={setTopicsOpen}>
        <SheetContent className="flex max-h-[85dvh] flex-col overflow-hidden p-0 pb-0">
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-1 pb-3">
            <SheetTitle className="not-sr-only font-display text-xl font-semibold text-foreground">
              Jump to a topic
            </SheetTitle>
            <SheetClose
              aria-label="Close"
              className="grid size-11 shrink-0 place-items-center rounded-full bg-muted text-foreground outline-none transition-colors hover:bg-muted/70 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
            >
              <X className="size-5" aria-hidden />
            </SheetClose>
          </div>
          <ul className="min-h-0 flex-1 touch-pan-y space-y-1.5 overflow-y-auto overscroll-contain px-3 pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
            {jumpItems.map((item) => {
              const Icon = SECTION_ICONS[item.id] ?? Sparkles;
              const active = activeId === item.id;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-current={active ? "location" : undefined}
                    onClick={() => {
                      setTopicsOpen(false);
                      openThenScroll(item.id);
                    }}
                    className={cn(
                      "flex min-h-16 w-full items-center gap-4 rounded-2xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
                      active ? "bg-primary/12" : "hover:bg-muted",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid size-11 shrink-0 place-items-center rounded-xl",
                        active ? "bg-primary text-primary-foreground" : "bg-primary/12 text-primary",
                      )}
                    >
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-display text-lg leading-tight font-semibold">{item.label}</span>
                      <span className="block text-[15px] leading-6 text-muted-foreground">{item.blurb}</span>
                    </span>
                    <ArrowRight className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </div>
  );
}

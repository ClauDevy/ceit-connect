"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  ChevronDown,
  CircleHelp,
  ImageIcon,
  Search,
} from "lucide-react";
import { Collapse, SectionEnter } from "@/components/shared/motion";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  HelpManualBlock,
  HelpManualFaq,
  HelpManualPayload,
  HelpManualSection,
} from "@/lib/help-manual";

type SectionId = string;

function ScreenshotSlot({ label }: { label: string }) {
  return (
    <div
      className="mt-4 grid min-h-36 place-items-center rounded-2xl border border-dashed bg-muted/40 p-5 text-center"
      aria-label={`Future screenshot: ${label}`}
    >
      <div className="space-y-2 text-muted-foreground">
        <ImageIcon className="mx-auto size-6" aria-hidden />
        <p className="text-sm font-medium text-foreground">Screenshot coming later</p>
        <p className="text-xs">{label}</p>
      </div>
    </div>
  );
}

function ManualBlocks({ blocks }: { blocks: readonly HelpManualBlock[] }) {
  return (
    <div className="space-y-7">
      {blocks.map((block) => (
        <div key={block.heading} className="space-y-3">
          <h3 className="font-display text-base font-semibold text-foreground">{block.heading}</h3>
          {block.paragraphs?.map((paragraph) => (
            <p key={paragraph} className="text-sm leading-6 text-muted-foreground">
              {paragraph}
            </p>
          ))}
          {block.bullets?.length ? (
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground marker:text-primary">
              {block.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
            </ul>
          ) : null}
          {block.screenshotLabel ? <ScreenshotSlot label={block.screenshotLabel} /> : null}
        </div>
      ))}
    </div>
  );
}

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
  if (faqs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed bg-muted/40 px-4 py-7 text-center">
        <Search className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium">No FAQ results</p>
        <p className="mt-1 text-xs text-muted-foreground">Try a shorter or different search.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {faqs.map((faq) => {
        const isOpen = expanded.has(faq.id);
        const panelId = `faq-${faq.id}-${idSuffix}`;
        return (
          <div key={faq.id} className="overflow-hidden rounded-xl border bg-card">
            <button
              type="button"
              className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-semibold outline-none transition-colors duration-[var(--motion-interaction-duration)] hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset motion-reduce:transition-none"
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => onToggle(faq.id)}
            >
              <span>{faq.question}</span>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 transition-transform duration-[var(--motion-panel-duration)] motion-reduce:transition-none",
                  isOpen && "rotate-180",
                )}
                aria-hidden
              />
            </button>
            <Collapse open={isOpen}>
              <div id={panelId} className="space-y-2 border-t px-4 py-3 text-sm leading-6 text-muted-foreground">
                {faq.answer.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
            </Collapse>
          </div>
        );
      })}
    </div>
  );
}

function FaqContents({
  query,
  onQueryChange,
  filteredFaqs,
  expandedFaqs,
  onToggleFaq,
  idSuffix,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  filteredFaqs: readonly HelpManualFaq[];
  expandedFaqs: ReadonlySet<string>;
  onToggleFaq: (id: string) => void;
  idSuffix: string;
}) {
  const searchId = `faq-search-${idSuffix}`;
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor={searchId} className="text-sm font-medium">Search questions</label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search the FAQ"
            className="pl-9"
          />
        </div>
      </div>
      <FaqList faqs={filteredFaqs} expanded={expandedFaqs} onToggle={onToggleFaq} idSuffix={idSuffix} />
    </div>
  );
}

function SectionCard({
  section,
  mobileOpen,
  onToggle,
}: {
  section: HelpManualSection;
  mobileOpen: boolean;
  onToggle: () => void;
}) {
  const mobilePanelId = `${section.id}-mobile-panel`;
  return (
    <SectionEnter as="section" id={section.id} tabIndex={-1} className="scroll-mt-24" aria-labelledby={`${section.id}-title`}>
      <Card className="overflow-hidden">
        <CardHeader className="border-b bg-muted/30">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
            aria-expanded={mobileOpen}
            aria-controls={mobilePanelId}
            onClick={onToggle}
          >
            <span className="space-y-1">
              <span id={`${section.id}-title`} className="block font-display text-lg font-semibold">{section.title}</span>
              <span className="block text-sm font-normal text-muted-foreground">{section.summary}</span>
            </span>
            <ChevronDown
              className={cn(
                "size-5 shrink-0 transition-transform duration-[var(--motion-panel-duration)] motion-reduce:transition-none",
                mobileOpen && "rotate-180",
              )}
              aria-hidden
            />
          </button>
          <div className="hidden md:block">
            <CardTitle id={`${section.id}-desktop-title`}>{section.title}</CardTitle>
            <CardDescription>{section.summary}</CardDescription>
          </div>
        </CardHeader>
        <div className="md:hidden">
          <Collapse open={mobileOpen}>
            <CardContent id={mobilePanelId} className="pt-5">
              <ManualBlocks blocks={section.blocks} />
            </CardContent>
          </Collapse>
        </div>
        <CardContent className="hidden pt-5 md:block">
          <ManualBlocks blocks={section.blocks} />
        </CardContent>
      </Card>
    </SectionEnter>
  );
}

export function HelpManual({ manual }: { manual: HelpManualPayload }) {
  const [openSections, setOpenSections] = useState<Set<SectionId>>(() => new Set(["quick-start"]));
  const [expandedFaqs, setExpandedFaqs] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const pendingScroll = useRef<string | null>(null);
  const pendingFocus = useRef<string | null>(null);
  const [scrollRequest, setScrollRequest] = useState(0);

  const filteredFaqs = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return manual.faqs;
    return manual.faqs.filter((faq) =>
      [faq.question, ...faq.answer].join(" ").toLocaleLowerCase().includes(needle),
    );
  }, [manual.faqs, query]);

  useEffect(() => {
    const targetId = pendingScroll.current;
    if (!targetId) return;
    const target = document.getElementById(targetId);
    if (!target) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    pendingScroll.current = null;
    if (pendingFocus.current === targetId) {
      target.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }, [openSections, scrollRequest]);

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
    const needle = value.trim().toLocaleLowerCase();
    if (!needle) return;
    const firstMatch = manual.faqs.find((faq) =>
      [faq.question, ...faq.answer].join(" ").toLocaleLowerCase().includes(needle),
    );
    setOpenSections((current) => new Set(current).add("faq"));
    if (firstMatch) setExpandedFaqs((current) => new Set(current).add(firstMatch.id));
    requestScroll("faq");
  }

  const jumpItems = [
    ...manual.sections.map((section) => ({ id: section.id, label: section.title })),
    { id: "faq", label: "FAQ & troubleshooting" },
    { id: "to-confirm", label: "To confirm with the owner" },
  ];

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="hidden lg:sticky lg:top-4 lg:block">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenText className="size-4 text-primary" aria-hidden /> On this page
            </CardTitle>
          </CardHeader>
          <CardContent>
            <nav aria-label="Help sections" className="flex flex-col gap-1">
              {jumpItems.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  className="rounded-lg px-3 py-2 text-sm text-muted-foreground outline-none transition-colors duration-[var(--motion-interaction-duration)] hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
                  onClick={(event) => {
                    event.preventDefault();
                    openThenScroll(item.id);
                  }}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          </CardContent>
        </Card>
      </aside>

      <div className="min-w-0 space-y-5">
        <Card className="lg:hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Jump to</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {jumpItems.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="inline-flex min-h-11 items-center rounded-xl border bg-background px-3 py-2 text-sm font-medium outline-none transition-colors duration-[var(--motion-interaction-duration)] hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none"
                onClick={(event) => {
                  event.preventDefault();
                  openThenScroll(item.id);
                }}
              >
                {item.label}
              </a>
            ))}
          </CardContent>
        </Card>

        {manual.sections.map((section) => (
          <SectionCard
            key={section.id}
            section={section}
            mobileOpen={openSections.has(section.id)}
            onToggle={() => toggleSection(section.id)}
          />
        ))}

        <SectionEnter as="section" id="faq" tabIndex={-1} className="scroll-mt-24" aria-labelledby="faq-title">
          <Card className="overflow-hidden">
            <CardHeader className="border-b bg-muted/30">
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
                aria-expanded={openSections.has("faq")}
                aria-controls="faq-mobile-panel"
                onClick={() => toggleSection("faq")}
              >
                <span className="space-y-1">
                  <span id="faq-title" className="block font-display text-lg font-semibold">FAQ & troubleshooting</span>
                  <span className="block text-sm font-normal text-muted-foreground">Search questions available to your role.</span>
                </span>
                <ChevronDown className={cn("size-5 transition-transform duration-[var(--motion-panel-duration)] motion-reduce:transition-none", openSections.has("faq") && "rotate-180")} aria-hidden />
              </button>
              <div className="hidden md:block">
                <CardTitle>FAQ & troubleshooting</CardTitle>
                <CardDescription>Search questions available to your role.</CardDescription>
              </div>
            </CardHeader>
            <div className="md:hidden">
              <Collapse open={openSections.has("faq")}>
                <CardContent id="faq-mobile-panel" className="pt-5">
                  <FaqContents query={query} onQueryChange={changeQuery} filteredFaqs={filteredFaqs} expandedFaqs={expandedFaqs} onToggleFaq={toggleFaq} idSuffix="mobile" />
                </CardContent>
              </Collapse>
            </div>
            <CardContent className="hidden pt-5 md:block">
              <FaqContents query={query} onQueryChange={changeQuery} filteredFaqs={filteredFaqs} expandedFaqs={expandedFaqs} onToggleFaq={toggleFaq} idSuffix="desktop" />
            </CardContent>
          </Card>
        </SectionEnter>

        <SectionEnter as="section" id="to-confirm" tabIndex={-1} className="scroll-mt-24" aria-labelledby="to-confirm-title">
          <Card className="overflow-hidden border-dashed">
            <CardHeader className="border-b bg-muted/30">
              <button
                type="button"
                className="flex min-h-11 w-full items-center justify-between gap-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
                aria-expanded={openSections.has("to-confirm")}
                aria-controls="to-confirm-mobile-panel"
                onClick={() => toggleSection("to-confirm")}
              >
                <span className="space-y-1">
                  <span id="to-confirm-title" className="block font-display text-lg font-semibold">To confirm with the owner</span>
                  <span className="block text-sm font-normal text-muted-foreground">Details intentionally left open instead of guessed.</span>
                </span>
                <ChevronDown className={cn("size-5 transition-transform duration-[var(--motion-panel-duration)] motion-reduce:transition-none", openSections.has("to-confirm") && "rotate-180")} aria-hidden />
              </button>
              <div className="hidden md:block">
                <CardTitle className="flex items-center gap-2"><CircleHelp className="size-5 text-primary" aria-hidden /> To confirm with the owner</CardTitle>
                <CardDescription>Details intentionally left open instead of guessed.</CardDescription>
              </div>
            </CardHeader>
            <div className="md:hidden">
              <Collapse open={openSections.has("to-confirm")}>
                <CardContent id="to-confirm-mobile-panel" className="pt-5">
                  <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground marker:text-primary">
                    {manual.confirmations.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </CardContent>
              </Collapse>
            </div>
            <CardContent className="hidden pt-5 md:block">
              <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground marker:text-primary">
                {manual.confirmations.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </CardContent>
          </Card>
        </SectionEnter>
      </div>
    </div>
  );
}

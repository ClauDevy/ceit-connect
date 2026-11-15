import type { ReactElement } from "react";
import { TigerHead } from "@/components/ui/tiger-parts";
import { cn } from "@/lib/utils";
import type { HelpIllustrationId } from "@/lib/help-manual";

/**
 * Small friendly drawings for the Help page. They replace the old grey
 * "Screenshot coming later" boxes. Everything is plain SVG painted with the theme
 * tokens (fill-card, fill-primary, ...), so light and dark mode both work, and
 * there is no motion at all. The tiger head is the same one used in the logo.
 */

function TigerBadge({ cx, cy, size }: { cx: number; cy: number; size: number }) {
  // TigerHead is drawn in a 160-unit box, centred on (80, 72), and is about 100 wide.
  const scale = size / 100;
  return (
    <g transform={`translate(${cx - 80 * scale} ${cy - 72 * scale}) scale(${scale})`}>
      <TigerHead />
    </g>
  );
}

function PhoneArt() {
  const tiles = [
    [38, 44], [70, 44], [102, 44],
    [38, 76], [70, 76], [102, 76],
    [38, 108], [102, 108],
    [38, 140], [70, 140], [102, 140],
  ];
  return (
    <>
      {/* the phone */}
      <rect x="24" y="10" width="116" height="204" rx="24" className="fill-card stroke-foreground/25" strokeWidth="3" />
      <rect x="62" y="19" width="40" height="7" rx="3.5" className="fill-muted" />
      {tiles.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="24" height="24" rx="7" className="fill-muted" />
      ))}
      {/* the CEIT Connect icon, highlighted */}
      <circle cx="82" cy="120" r="23" className="fill-none stroke-primary/50" strokeWidth="2" strokeDasharray="4 4" />
      <rect x="70" y="108" width="24" height="24" rx="7" className="fill-primary/15 stroke-primary" strokeWidth="2" />
      <TigerBadge cx={82} cy={120} size={19} />
      <rect x="52" y="180" width="60" height="5" rx="2.5" className="fill-foreground/20" />

      {/* arrow from the menu to the icon */}
      <path d="M168 112 C 154 112, 146 118, 112 120" className="fill-none stroke-primary" strokeWidth="3" strokeLinecap="round" strokeDasharray="1 7" />
      <path d="M120 112 L108 120 L120 128" className="fill-none stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

      {/* the share menu */}
      <rect x="168" y="40" width="196" height="146" rx="18" className="fill-card stroke-border" strokeWidth="2" />
      <rect x="180" y="52" width="172" height="34" rx="10" className="fill-muted" />
      <rect x="191" y="62" width="14" height="14" rx="3" className="fill-none stroke-muted-foreground" strokeWidth="2" />
      <path d="M198 56 V68 M193 61 L198 56 L203 61" className="fill-none stroke-muted-foreground" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="216" y="74" className="fill-foreground font-sans text-[14px] font-semibold">Share</text>
      <rect x="180" y="94" width="172" height="40" rx="10" className="fill-primary" />
      <rect x="190" y="104" width="20" height="20" rx="5" className="fill-none stroke-primary-foreground" strokeWidth="2" />
      <path d="M200 108 V120 M194 114 H206" className="fill-none stroke-primary-foreground" strokeWidth="2" strokeLinecap="round" />
      <text x="218" y="119" className="fill-primary-foreground font-sans text-[12px] font-bold">Add to Home Screen</text>
      <rect x="180" y="142" width="172" height="34" rx="10" className="fill-muted" />
      <rect x="191" y="153" width="76" height="6" rx="3" className="fill-foreground/20" />
      <rect x="191" y="164" width="52" height="5" rx="2.5" className="fill-foreground/10" />

      {/* done */}
      <circle cx="378" cy="24" r="15" className="fill-success" />
      <path d="M371 24 L376 29 L385 19" className="fill-none stroke-card" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  );
}

function BoardArt() {
  const lanes = [
    { x: 14, title: "To Do", cards: ["fill-priority-high", "fill-priority-medium", "fill-priority-low"], done: false },
    { x: 142, title: "In Progress", cards: ["fill-priority-critical", "fill-priority-medium"], done: false },
    { x: 270, title: "Completed", cards: ["fill-success", "fill-success"], done: true },
  ];
  return (
    <>
      {/* phases */}
      <rect x="14" y="10" width="88" height="24" rx="12" className="fill-success/15 stroke-success" strokeWidth="1.5" />
      <path d="M26 22 L31 27 L40 17" className="fill-none stroke-success" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="48" y="27" className="fill-foreground font-sans text-[12px] font-semibold">Phase 1</text>
      <rect x="110" y="10" width="88" height="24" rx="12" className="fill-primary" />
      <text x="128" y="27" className="fill-primary-foreground font-sans text-[12px] font-bold">Phase 2</text>
      <rect x="206" y="10" width="88" height="24" rx="12" className="fill-muted stroke-border" strokeWidth="1.5" />
      <text x="224" y="27" className="fill-muted-foreground font-sans text-[12px] font-semibold">Phase 3</text>

      {lanes.map((lane) => (
        <g key={lane.title}>
          <rect x={lane.x} y="46" width="116" height="176" rx="14" className="fill-muted/70 stroke-border" strokeWidth="1.5" />
          <text x={lane.x + 12} y="68" className="fill-foreground font-sans text-[13px] font-bold">{lane.title}</text>
          {lane.cards.map((tone, index) => {
            const y = 80 + index * 46;
            return (
              <g key={index}>
                <rect x={lane.x + 10} y={y} width="96" height="38" rx="9" className="fill-card stroke-border" strokeWidth="1.5" />
                <rect x={lane.x + 10} y={y + 7} width="4" height="24" rx="2" className={tone} />
                <rect x={lane.x + 22} y={y + 9} width="58" height="6" rx="3" className="fill-foreground/25" />
                <rect x={lane.x + 22} y={y + 22} width="36" height="5" rx="2.5" className="fill-foreground/12" />
                {lane.done ? (
                  <path d={`M${lane.x + 88} ${y + 19} l4 4 l8 -9`} className="fill-none stroke-success" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                ) : null}
              </g>
            );
          })}
        </g>
      ))}
    </>
  );
}

function EventsArt() {
  const cards = [
    { x: 14, label: "Draft", dashed: true },
    { x: 142, label: "Active", dashed: false },
    { x: 270, label: "Archived", dashed: false },
  ];
  return (
    <>
      {cards.map((card, i) => {
        const active = i === 1;
        const archived = i === 2;
        return (
          <g key={card.label}>
            <rect
              x={card.x}
              y="22"
              width="116"
              height="176"
              rx="16"
              className={cn("fill-card", active ? "stroke-primary" : "stroke-border")}
              strokeWidth={active ? 3 : 2}
              strokeDasharray={card.dashed ? "6 5" : undefined}
            />
            {/* banner */}
            <rect x={card.x + 10} y="32" width="96" height="56" rx="10" className={active ? "fill-primary/20" : "fill-muted"} />
            {active ? <TigerBadge cx={card.x + 58} cy={60} size={34} /> : null}
            {i === 0 ? <path d={`M${card.x + 34} 78 l16 -22 l11 14 l8 -9 l15 17 z`} className="fill-muted-foreground/40" strokeLinejoin="round" /> : null}
            {archived ? (
              <g>
                <rect x={card.x + 46} y="58" width="24" height="19" rx="4" className="fill-muted-foreground/60" />
                <path d={`M${card.x + 51} 58 v-6 a7 7 0 0 1 14 0 v6`} className="fill-none stroke-muted-foreground/60" strokeWidth="4" strokeLinecap="round" />
              </g>
            ) : null}
            {/* badge */}
            <rect
              x={card.x + 10}
              y="100"
              width={card.label === "Archived" ? 66 : 52}
              height="22"
              rx="11"
              className={active ? "fill-primary" : "fill-muted stroke-border"}
              strokeWidth="1.5"
            />
            <text
              x={card.x + 20}
              y="115.5"
              className={cn("font-sans text-[12px] font-bold", active ? "fill-primary-foreground" : "fill-foreground")}
            >
              {card.label}
            </text>
            <rect x={card.x + 10} y="134" width="84" height="7" rx="3.5" className="fill-foreground/25" />
            <rect x={card.x + 10} y="148" width="58" height="6" rx="3" className="fill-foreground/12" />
            {active ? (
              <>
                <rect x={card.x + 10} y="170" width="96" height="8" rx="4" className="fill-muted" />
                <rect x={card.x + 10} y="170" width="58" height="8" rx="4" className="fill-primary" />
              </>
            ) : (
              <rect x={card.x + 10} y="170" width="40" height="6" rx="3" className="fill-foreground/12" />
            )}
          </g>
        );
      })}
      {/* arrows between the cards */}
      {[130, 258].map((x) => (
        <path key={x} d={`M${x - 2} 110 h12 m-5 -6 l6 6 l-6 6`} className="fill-none stroke-primary" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </>
  );
}

function BellArt() {
  return (
    <>
      {/* bell list */}
      <rect x="14" y="14" width="196" height="196" rx="18" className="fill-card stroke-border" strokeWidth="2" />
      <text x="30" y="42" className="fill-foreground font-sans text-[14px] font-bold">Notifications</text>
      <line x1="14" y1="54" x2="210" y2="54" className="stroke-border" strokeWidth="1.5" />
      {[0, 1, 2].map((i) => {
        const y = 66 + i * 46;
        const unread = i < 2;
        return (
          <g key={i}>
            <rect x="24" y={y} width="176" height="38" rx="10" className={unread ? "fill-primary/10" : "fill-muted/60"} />
            <circle cx="40" cy={y + 19} r="5.5" className={unread ? "fill-primary" : "fill-muted-foreground/40"} />
            <rect x="54" y={y + 9} width={unread ? 110 : 96} height="6.5" rx="3.25" className="fill-foreground/30" />
            <rect x="54" y={y + 22} width="70" height="5.5" rx="2.75" className="fill-foreground/14" />
          </g>
        );
      })}

      {/* phone alert */}
      <rect x="222" y="30" width="172" height="68" rx="16" className="fill-card stroke-border" strokeWidth="2" />
      <rect x="234" y="42" width="36" height="36" rx="10" className="fill-primary/15" />
      <TigerBadge cx={252} cy={60} size={28} />
      <text x="278" y="56" className="fill-muted-foreground font-sans text-[11px] font-semibold">CEIT Connect</text>
      <text x="278" y="76" className="fill-foreground font-sans text-[12px] font-bold">3 tasks due soon</text>

      {/* big bell */}
      <g transform="translate(308 150)">
        <path
          d="M0 -42 C-22 -42 -34 -26 -34 -6 V14 L-44 28 H44 L34 14 V-6 C34 -26 22 -42 0 -42 Z"
          className="fill-primary/20 stroke-primary"
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <path d="M-12 36 a12 12 0 0 0 24 0" className="fill-primary" />
        <circle cx="0" cy="-46" r="5" className="fill-primary" />
        <circle cx="30" cy="-30" r="15" className="fill-primary" />
        <text x="30" y="-24.5" textAnchor="middle" className="fill-primary-foreground font-sans text-[16px] font-bold">3</text>
      </g>
    </>
  );
}

function LeadershipArt() {
  const groups = [20, 144, 268];
  return (
    <>
      {/* connectors */}
      <path d="M200 52 V66 M76 66 H324 M76 66 V80 M200 66 V80 M324 66 V80" className="fill-none stroke-border" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

      {/* Admin */}
      <rect x="130" y="8" width="140" height="44" rx="22" className="fill-primary" />
      <path d="M156 20 l10 4 v8 c0 6 -4 9 -10 12 c-6 -3 -10 -6 -10 -12 v-8 z" className="fill-primary-foreground/20 stroke-primary-foreground" strokeWidth="2" strokeLinejoin="round" />
      <path d="M151.5 31 l3.5 3.5 l6 -7" className="fill-none stroke-primary-foreground" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <text x="178" y="36" className="fill-primary-foreground font-sans text-[16px] font-bold">Admin</text>

      {groups.map((x) => (
        <g key={x}>
          <rect x={x} y="80" width="112" height="140" rx="16" className="fill-muted/60 stroke-border" strokeWidth="2" strokeDasharray="6 5" />
          <rect x={x + 10} y="92" width="92" height="34" rx="17" className="fill-accent stroke-primary" strokeWidth="2" />
          <text x={x + 56} y="114" textAnchor="middle" className="fill-accent-foreground font-sans text-[13px] font-bold">Co-Admin</text>
          <path d={`M${x + 56} 126 V140`} className="stroke-border" strokeWidth="3" strokeLinecap="round" />
          {[0, 1].map((row) =>
            [0, 1].map((col) => (
              <g key={`${row}-${col}`}>
                <rect x={x + 10 + col * 48} y={142 + row * 36} width="44" height="30" rx="10" className="fill-card stroke-border" strokeWidth="1.5" />
                <circle cx={x + 32 + col * 48} cy={152 + row * 36} r="4.5" className="fill-muted-foreground/50" />
                <path d={`M${x + 24 + col * 48} ${167 + row * 36} a8 6 0 0 1 16 0`} className="fill-muted-foreground/50" />
              </g>
            )),
          )}
        </g>
      ))}
    </>
  );
}

const ART: Record<HelpIllustrationId, { Art: () => ReactElement; viewBox: string; label: string; caption: string }> = {
  phone: {
    Art: PhoneArt,
    viewBox: "0 0 400 224",
    label: "A phone adding CEIT Connect to its home screen",
    caption: "On iPhone: tap Share, then Add to Home Screen. The app then opens like any other app.",
  },
  board: {
    Art: BoardArt,
    viewBox: "0 0 400 232",
    label: "An event board with three phases and three lanes",
    caption: "An event board: phases at the top, and three lanes of task cards below.",
  },
  events: {
    Art: EventsArt,
    viewBox: "0 0 400 220",
    label: "An event moving from Draft to Active to Archived",
    caption: "An event starts as a Draft, becomes Active, and ends as a read-only Archived record.",
  },
  bell: {
    Art: BellArt,
    viewBox: "0 0 400 224",
    label: "The notification bell list and a short phone alert",
    caption: "The bell lists every alert. Your phone shows short reminders.",
  },
  leadership: {
    Art: LeadershipArt,
    viewBox: "0 0 400 228",
    label: "An Admin above three committees, each with a Co-Admin and Members",
    caption: "Admins work across every committee. Each Co-Admin manages their own committee.",
  },
};

export function HelpIllustration({ id }: { id: HelpIllustrationId }) {
  const { Art, viewBox, label, caption } = ART[id];
  return (
    <figure className="overflow-hidden rounded-2xl border bg-linear-to-br from-primary/[0.09] via-background to-accent/30">
      <svg viewBox={viewBox} role="img" aria-label={label} className="mx-auto block h-auto w-full max-w-lg p-3 sm:p-5">
        <Art />
      </svg>
      <figcaption className="border-t bg-card/70 px-4 py-3 text-center text-sm text-muted-foreground sm:text-[15px]">
        {caption}
      </figcaption>
    </figure>
  );
}

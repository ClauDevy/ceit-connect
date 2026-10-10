# HTML prototypes (design source)

These are the original mock-data prototypes. They show the intended **layout and behavior**; the real pages are built in Next.js against Supabase. Do not copy their markup verbatim — rebuild each page with the shared components in `src/components/ui` and `src/components/shared`.

## Page → file map

| Page | File | Notes |
|---|---|---|
| Home (event list / timeline) | `index.html` | Likely the Home page — confirm by opening it or reading its `<title>` |
| Event board (Kanban: phase tabs, three lanes, backlog) | `event.html` | Phase 4 design source; confirm by `<title>` |
| Create Event (Fundamentals + Tasks tabs, mode picker, live summary) | `create-event.html` | Phase 3 Steps 1, 3, 5 |
| Edit Event | `edit-event.html` | Phase 3 Step 4 |
| Event Archives | `archive.html` | Phase 3 Step 6 |
| My Tasks / Help Wanted | `tasks.html` | Phase 4 |
| Executive Dashboard (drill-down chart) | `dashboard.html` | Phase 5 |
| Activity Log | `activity-log.html` | Admin only |
| Notifications | `notifications.html` | Phase 5 |
| Settings | `settings.html` | Already built some in the real app |
| Login | `login.html` | Already built in the real app |
| Shared styles / Tailwind config | `style.css`, `tailwind-config.js` | The pages link to these; `tailwind-config.js` defines the raw palette |

Two extra files, `ceit-connect-home.html` and `ceit-connect-create-event.html`, are self-contained exports of earlier versions of the same designs. **If they ever differ from the plain-named originals above, prefer the originals.**

Keep `style.css` and `tailwind-config.js` in this folder — opening a page in a browser without them breaks its styling.

## Translating prototype classes to the real app's tokens
The prototypes use a Tailwind CDN config with raw palette names. The real app uses semantic tokens defined in `src/app/globals.css`:

| Prototype class | Real app class |
|---|---|
| `bg-paper` / `text-ink` | `bg-background` / `text-foreground` |
| `bg-card` | `bg-card` |
| `bg-council` / `text-council` | `bg-primary` / `text-primary` |
| `bg-council-wash` | `bg-muted` |
| `text-council-dark` | `text-accent-foreground` |
| `bg-slate-100` / `border-slate-300` | `bg-secondary` / `border` |
| `text-slate-500` / `text-slate-700` | `text-muted-foreground` / `text-secondary-foreground` |
| `night-*` (dark mode values) | automatic — the same tokens switch under `.dark` |

Never hard-code hex colors in components.

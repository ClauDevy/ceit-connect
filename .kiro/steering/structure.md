# Project Structure — CEIT Connect

```
src/
  app/
    (dashboard)/        protected pages: home, workspace, archives, dashboard,
                        activity-log, users, settings, (events/new)
    api/<name>/route.ts server-only route handlers (invite, set-password, complete-reset,
                        update-avatar, toggle-user-active)
    auth/               callback/route.ts, signout/route.ts
    login/page.tsx      public sign-in page
    sandbox/page.tsx    mock-data playground
  components/
    ui/                 primitives (Button, Input, FormField, Dialog, Table, Badge, ...)
    shared/             PageHeader, EmptyState, ConfirmDialog, UserAvatar, page skeletons
    layout/             AppShell, desktop sidebar, mobile nav/topbar, user card
    auth/ settings/ users/ navigation/ theme/    feature components
  lib/                  auth.ts (requireUser), nav.ts (nav items per role), types.ts,
                        utils.ts (cn), supabase/*
  hooks/                use-theme, use-sidebar-collapsed
supabase/migrations/    tracked SQL — the only way schema/policies change
docs/                   ARCHITECTURE, DATABASE, PROGRESS, PHASE-3-PLAN, GOTCHAS, prototypes/
```

**Where new things go:** a page → `src/app/(dashboard)/<route>/page.tsx` (+ `loading.tsx`); an API route → `src/app/api/<name>/route.ts`; feature components → `src/components/<feature>/`; a nav link → `src/lib/nav.ts` (with its allowed roles). Files are kebab-case. Use the `@/` alias.

**Reading the data layer:** `docs/DATABASE.md` is the map of tables, RLS, and functions; `supabase/migrations/` is the truth.

## Spec rules (Kiro spec generation — keep specs small to save credits)

- Stay inside the **current** step of `docs/PHASE-3-PLAN.md`; never plan later steps.
- `requirements.md`: at most 8 requirements, at most 4 acceptance criteria each.
- `design.md`: concise; no diagrams, no test plans. Name the exact files to create/change and any migration needed.
- `tasks.md`: small, granular tasks. Every task ends with a verifiable check. The final task is always: `npm run build` and `npm run lint` pass, plus the exact manual test steps for the owner.
- Database changes are **migration files only** — never run `supabase db push` or `link`; list the command for the owner to run.
- Do not commit, push, or open PRs. Update `docs/PROGRESS.md` when a task set completes.

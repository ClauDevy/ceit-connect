<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:ceit-connect-guide -->

# CEIT Connect — guide for AI coding agents

Task delegation and tracking system for a 12-committee university student council (the CEIT Student Council, built by the eduCache.on team). Free-tier only. **Invite-only: there is no public sign-up.**

## Status

Phases 0–4 are complete and live on Dev and Prod: scaffold, database + RLS, auth, the event engine, and the task engine. **Phase 4B is planned; no Phase 4B code is built.**
Read `docs/PROGRESS.md` first for the exact current state, then `docs/PHASE-4B-PLAN.md` for the approved work and run order.

## Stack

Next.js 16 App Router, TypeScript, Tailwind v4 (CSS-first config in `src/app/globals.css`), shadcn-style components in `src/components/ui`, Base UI, Supabase (Postgres, Auth, Storage, RLS) via `@supabase/ssr`, React Query, react-hook-form + zod, zustand, dnd-kit. Deployed on Vercel. Path alias `@/` = `src/`.
Two separate Supabase projects: **Dev** (what `.env.local` points to) and **Prod** (live site).
Roles: `Admin`, `Co-Admin`, `Member`. 12 committees live in a `committees` table (not an enum).

## Commands

- `npm run dev` — local server (restart it after changing `.env.local`)
- `npm run build` — **run before every PR**; it catches type errors that dev mode lets through
- `npm run lint`
- `npx supabase migration new <n>` — create a migration file (write SQL in it)

## Golden rules (each one exists because of a real bug or security finding)

1. **Never run commands that write to a remote Supabase project.** No `supabase db push`, `link`, `db reset`, or anything touching Prod. Create the migration file, then tell the owner to run it.
2. Every schema or policy change is a **new tracked file** in `supabase/migrations/`. Never rely on ad-hoc SQL typed into the dashboard.
3. The service-role key is used **only** through `createServiceRoleClient()` in server-only code (route handlers, server actions) — never in a client component, never in a `NEXT_PUBLIC_*` variable. Every route that uses it must first re-verify the caller itself: logged in, correct role, **and `is_active`**.
4. **RLS is the real security; hiding UI is only UX.** Every role check in the UI needs a matching RLS policy or server-side check.
5. Pages must guard themselves. Call `requireUser()` from `@/lib/auth` (checks "logged in" only). For Admin/Co-Admin-only pages and routes, also call `getActiveProfileForRoles([...])` from the same file: it checks the role **and `is_active`**, and returns `null` when not allowed, so always handle the `null` (redirect or 403). Layouts and pages render in parallel, so a layout's redirect does not stop the page below it. Never write `user!`.
6. Confidential tasks: read title/description through `supabase.rpc('get_task', { p_task_id })`, never a raw `select` on `tasks`.
7. Never trust client-supplied values for security-relevant fields (`created_by`, `avatar_url`, `role`, ids). Derive them server-side or enforce them in RLS.
8. Never read, print, or commit `.env*` files or secrets. Env vars: `NEXT_PUBLIC_SUPABASE_URL` (the **bare** project URL, no path), `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `ALLOWED_EMAIL_DOMAINS`.
9. Users are **never deleted**, only deactivated (`is_active = false`) — this protects Event Archives.
10. Check the `error` of every Supabase call (never ignore it). Validate the runtime type of every request body field. Wrap client `fetch` calls in `try/catch/finally` so buttons can never get stuck.

Phase 4B "Remove former member" anonymizes the account and never deletes it.

## Phase 4B working rules

Read `docs/PHASE-4B-PLAN.md` first and ask up to 5 grouped questions about anything unclear or conflicting before planning. Plans use Medium reasoning; security-critical migrations use High. UI batches also read `docs/DESIGN-SYSTEM.md`. Use Philippine time only.

## Conventions

- Server Components by default; add `"use client"` only when a file needs hooks or event handlers.
- Reuse before creating: `src/components/ui/*` (Button, Input, FormField, Dialog, Badge, Card, Table, InlineAlert, ...) and `src/components/shared/*` (PageHeader, EmptyState, ConfirmDialog, UserAvatar).
- Colors: use the semantic tokens only (`bg-background`, `bg-card`, `bg-primary`, `bg-muted`, `text-muted-foreground`, `text-accent-foreground`, `border`, ...). Never hard-code hex colors. Dark mode comes from the same tokens.
- Every form field needs a matching `htmlFor` / `id`.
- Every new UI, including Activity Log, Executive Dashboard, and notifications, uses the shared motion kit and ships both a reduced-motion state and a test row; do not add one-off animation timers or libraries.
- New pages go under `src/app/(dashboard)/<route>/`; new API routes at `src/app/api/<n>/route.ts`; files are kebab-case.
- After a POST form/route, redirect with `NextResponse.redirect(url, 303)`, not 307.
- `events.start_date` / `end_date` are `date` columns — use `yyyy-mm-dd` strings from `<input type="date">`.

## How to work with the owner

The owner is a student learning as they build. Always:

- Give the **simplest route and ONE recommended path** — no menus of alternatives. Prefer point-and-click steps (VSCode Source Control, dashboards) over long terminal sequences.
- Explain **why** in plain language, not just what.
- **Stay on the thing asked.** Do not jump ahead to the next phase or feature.
- Work on a feature branch in small, reviewable changes. Do not commit, push, or open PRs unless asked.
- Before finishing: `npm run build` and `npm run lint` must pass, and you list the exact manual steps to test the change.
- After any real code or system change, **update `docs/PROGRESS.md`** and end your reply with a short **"Progress update"** block (what changed and why) that can be pasted into another session.

## Where the details live (read on demand, not all at once)

- `docs/ARCHITECTURE.md` — the spec: roles, modules, rules, phases, deviations the team approved
- `docs/DATABASE.md` — tables, columns, RLS, functions, storage, migration order
- `docs/PROGRESS.md` — what is done, decisions made, open items
- `docs/PHASE-4B-PLAN.md` — owner-approved Phase 4B scope, decisions, and batch order
- `docs/phase-4b/` — detailed Phase 4B batch documents as they are created
- `docs/GOTCHAS.md` — hard-won lessons; **read before touching auth, email, Supabase settings, or deployment**
- `docs/prototypes/*.html` — design source for pages not built yet; match their layout and behavior. **Each file is 30–125 KB: never read one in full, search for the section you need.**

<!-- END:ceit-connect-guide -->

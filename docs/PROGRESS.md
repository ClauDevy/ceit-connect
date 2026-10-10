# CEIT Connect — Progress log

**Last updated:** 2026-10-10. Keep this file current: after any real change, add a line under the right heading and move finished items out of "Open items".

## Phase 0 — Scaffold (done)
Next.js App Router + TypeScript + Tailwind; Vercel auto-deploys from `main`; Supabase Dev and Prod projects (same org, Singapore region); shadcn theme in the Council Orange / Slate palette (OKLCH variables in `globals.css`); Supabase client helpers (browser + server + service-role); `proxy.ts` (Next 16's renamed middleware) that only refreshes the session; `/sandbox` mock-data page.

## Phase 1 — Database and RLS (done, tested with impersonated users)
All six tables with RLS, helper functions, `get_task()`, activity-log trigger, assignee-guard trigger. Went through two independent security reviews (fixed: Co-Admin self-promotion to Admin, missing `search_path` on definer functions, assignee over-editing, forged `created_by`, activity-log leaks, an unattached trigger). See `docs/DATABASE.md`.

## Phase 2 — Auth, images, offboarding (done, live on Dev and Prod)
- Sign-in: magic link (`shouldCreateUser: false` = invite-only), password, Google (gated), forgot-password via typed 6-digit code, sign-out, back-button/bfcache guard.
- Invite User screen (`/api/invite`, Admin-only, domain-restricted, rolls back on failure).
- Settings: set/change password (re-verifies the current password), avatar upload/crop/compress/remove.
- Users page: Admin-only table with Deactivate/Reactivate; a deactivated account is signed out and blocked at login.
- Reviewed by CodeRabbit twice; every finding fixed (open redirect, deleting a real user on a DB error, avatar-URL write hole, deactivated Admin still able to call admin routes, ignored DB errors, stuck buttons, nested forms, and more).
- Pushed to Prod: migrations, Google provider, Site URL/redirect URLs, Gmail SMTP, email templates, `avatars` bucket, `ALLOWED_EMAIL_DOMAINS`, first Admin created by hand.

## UI redesign (done and pushed per the owner)
A full componentized redesign replaced the earlier single-file components: shared UI primitives in `src/components/ui`, shared pieces in `src/components/shared`, split-out auth components, `AppShell` with desktop sidebar + mobile nav, theme toggle (light/dark), loading skeletons, and a `requireUser()` helper in `src/lib/auth.ts`. Its backend routes were audited and kept every security fix.

## Phase 3 — Event engine (in progress, branch `feature/event-engine`)
Done:
- `events` table schema confirmed.
- **Step 1 — Create Event page** at `/events/new`: Fundamentals tab (name, start/end date, description), live summary with checks, **Save Draft** / **Launch Event** → real insert into `events` (`status` Draft/Active, `created_by` = signed-in user). Launch requires a name and valid dates (`end >= start`); a draft needs a name and start date (`start_date` is NOT NULL). CodeRabbit findings fixed (date order, label/`id` association, try/catch/finally).
- Migration `*_tighten_events_insert_policy.sql`: `events_insert` now also requires `created_by = auth.uid()`; confirmed live on Dev.

Not done: everything else in `docs/PHASE-3-PLAN.md` (Home with real events, Task Setup, Edit Event, Template Auto-Import, Event Archives, banner upload, Drive preview). The Tasks tab and banner box on `/events/new` are placeholders. There is no nav link to `/events/new` yet.

## Decisions log
- Magic link remains the required first login; password and Google are optional extras unlocked after it.
- Gmail SMTP (App Password) is the interim email sender; revisit Resend only if the team buys a domain.
- Invites/user management are Admin-only; users are deactivated, never deleted.
- Dev allows `gmail.com` invites for testing; Prod is meant to end up university-domain-only.
- Phase 3 is built one feature at a time: wire an existing HTML prototype to real Supabase data, test it, then move on.
- Git flow: one feature branch per task → CodeRabbit → PR → merge → then push the migration to Prod (the owner does all Supabase CLI pushes).

## Verify (not confirmed in the chat history — check before relying on them)
- [ ] Was the `feature/event-engine` PR merged to `main`?
- [ ] Was the `tighten_events_insert_policy` migration pushed to **Prod**? (Dev is confirmed.)
- [ ] Is the UI redesign merged to `main` and deployed on Vercel without build errors? (`npm run build` should pass.)
- [ ] Leftovers removed: `src/components/layout/sidebar.tsx` (old), `src/components/settings/reset-password-form.tsx` (dead code), unused packages `cn` and `p` in `package.json`.
- [ ] The service-role key does not appear in any client bundle (Phase 2 gate check).

## Open items
- Tighten `ALLOWED_EMAIL_DOMAINS` on Prod to the university domain only (Vercel env var + redeploy).
- Deactivate the mistyped fake-email test account on Prod (can't delete — by design).
- Restyle `/events/new` with the shared components (`PageHeader`, `Button`, `FormField`, `Input`, `InlineAlert`) so it matches the redesign.
- Banner upload (same crop/compress pattern as avatars, 16:9, 1–1.5 MB) — deferred from Step 1.
- `discord_id` field in Settings — parked until Discord webhooks are scheduled.
- No automated RLS tests yet (the plan calls for a pgTAP/Supabase test suite in CI; only manual `SET ROLE` tests exist).
- `/docs/BACKUP.md` runbook not written (Phase 5).

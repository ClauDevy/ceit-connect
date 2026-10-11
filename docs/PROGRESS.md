# CEIT Connect — Progress log

**Last updated:** 2026-10-11. Keep this file current: after any real change, add a line under the right heading and move finished items out of "Open items".

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
- Home now shows a Council Orange `+` Create Event action to active Admins and Co-Admins only. This Home action is the only UI entry point to `/events/new`; there is no sidebar or mobile-nav link. `/events/new` has its own server-side active-role guard and redirects Members to `/home`; no event edit route exists yet to guard.
- **Step 2 — Home shows real events**: signed-in users see RLS-scoped Active events; all active Admins and Co-Admins see Drafts, while Members never do. Events are sorted by soonest start date. Active cards have clear status and date ranges; Drafts use a dashed border and neutral badge with accurate visibility text; the no-events state uses the tiger mascot; Home has a matching loading skeleton. Saving an event returns to a freshly rendered Home list.
- Migration `20261011114905_update_event_visibility_and_edit_permissions.sql` is prepared (not yet pushed to Dev or Prod): active Admins/Co-Admins can see and edit any Draft/Active event, Co-Admins can launch any Draft, nobody can change Active back to Draft, only Admins can archive, Archived event rows cannot be updated or un-archived, and `created_by` is immutable.

Not done: everything else in `docs/PHASE-3-PLAN.md` (Task Setup, Edit Event, Template Auto-Import, Event Archives, banner upload, Drive preview). The Tasks tab and banner box on `/events/new` are placeholders.

## Decisions log
- Magic link remains the required first login; password and Google are optional extras unlocked after it.
- Gmail SMTP (App Password) is the interim email sender; revisit Resend only if the team buys a domain.
- Invites/user management are Admin-only; users are deactivated, never deleted.
- Dev allows `gmail.com` invites for testing; Prod is meant to end up university-domain-only.
- Phase 3 is built one feature at a time: wire an existing HTML prototype to real Supabase data, test it, then move on.
- Event access deliberately differs from the original spec: Drafts are shared among active Admins/Co-Admins, and any of them may edit or launch a Draft; Members never see Drafts, Active events cannot return to Draft, only Admins may archive/delete, and Archived events cannot be un-archived.
- Git flow: one feature branch per task → CodeRabbit → PR → merge → then push the migration to Prod (the owner does all Supabase CLI pushes).

## Status checks (answered 2026-10-10)
- `feature/event-engine` PR merged to `main`: YES
- `tighten_events_insert_policy` migration pushed to Prod:  YES
- UI redesign merged and deployed on Vercel, `npm run build` passes: YES 
- Leftovers (`sidebar.tsx`, `reset-password-form.tsx`, packages `cn` and `p`) removed: YES 
- Service-role key not in any client bundle: YES 

Next up: Phase 3 Step 3 (see `docs/PHASE-3-PLAN.md`).
Restyling `/events/new` happens later, when Step 3 touches that page.

## Open items
- Tighten `ALLOWED_EMAIL_DOMAINS` on Prod to the university domain only (Vercel env var + redeploy).
- Deactivate the mistyped fake-email test account on Prod (can't delete — by design).
- Restyle `/events/new` with the shared components (`PageHeader`, `Button`, `FormField`, `Input`, `InlineAlert`) so it matches the redesign.
- Banner upload (same crop/compress pattern as avatars, 16:9, 1–1.5 MB) — deferred from Step 1.
- `discord_id` field in Settings — parked until Discord webhooks are scheduled.
- No automated RLS tests yet (the plan calls for a pgTAP/Supabase test suite in CI; only manual `SET ROLE` tests exist).
- `/docs/BACKUP.md` runbook not written (Phase 5).

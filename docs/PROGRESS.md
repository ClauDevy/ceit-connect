# CEIT Connect — Progress log

**Last updated:** 2026-10-12. Keep this file current: after any real change, add a line under the right heading and move finished items out of "Open items".

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
- **Step 1 — Create Event page** at `/events/new`: Fundamentals tab (name, start/end date, description), live summary with checks, **Save Draft** / **Launch Event** → real insert into `events` (`status` Draft/Active, `created_by` = signed-in user). Launch requires a name and valid dates (`end >= start`); a draft needs a name and start date (`start_date` is NOT NULL). Save buttons remain disabled after a successful RPC while navigation completes, and return to idle only after a failed save.
- Migration `*_tighten_events_insert_policy.sql`: `events_insert` now also requires `created_by = auth.uid()`; confirmed live on Dev.
- Home now shows a Council Orange `+` Create Event action to active Admins and Co-Admins only. This Home action is the only UI entry point to `/events/new`; there is no sidebar or mobile-nav link. `/events/new` has its own server-side active-role guard and redirects Members to `/home`; no event edit route exists yet to guard.
- **Step 2 — Home shows real events**: signed-in users see RLS-scoped Active events; all active Admins and Co-Admins see Drafts, while Members never do. Events are sorted by soonest start date. Active cards have clear status and date ranges; Drafts use a dashed border and neutral badge with accurate visibility text; the no-events state uses the tiger mascot; Home has a matching loading skeleton. Saving an event returns to a freshly rendered Home list.
- Migration `20261011114905_update_event_visibility_and_edit_permissions.sql` is applied to Dev: active Admins/Co-Admins can see and edit any Draft/Active event, Co-Admins can launch any eligible Draft, nobody can change Active back to Draft, only Admins can archive, Archived event rows cannot be updated or un-archived, and `created_by` is immutable.
- **Step 3 — Task Setup** is implemented: `/events/new` now supports phases and add/edit/remove task drafts with title, description, committee, Deliverable/Live Operation type, due date, priority, and optional cross-committee assignees. Live Operations expose the existing call/end-time columns and warning. The searchable picker groups the task committee first, preserves selections when the committee changes, and never receives email/role data. Empty phases are visibly not saved; unassigned tasks go to the Backlog; Co-Admins receive only their committee in the task committee dropdown. Launch requires at least one task, while an empty Draft remains valid.
- Migration `20261011180000_enforce_draft_task_visibility.sql` is prepared (not yet pushed): Members cannot read or update tasks in Draft events, `get_task()` enforces the same rule despite being security-definer, and the activity-log policy blocks Draft task snapshots from Members.
- Migration `20261011180100_create_event_with_tasks.sql` is prepared (not yet pushed): a restricted security-definer RPC lists only safe active-user fields for privileged task creators, while the invoker-security creation RPC atomically creates the event plus up to 200 tasks, derives `created_by`, rejects missing or wrongly typed required task fields, saves Live Operation times, limits text fields, and validates that assignees exist and are active regardless of committee. It rejects Archived input and Active events with zero tasks.
- Migration `20261011200000_require_tasks_when_launching_events.sql` is prepared (not yet pushed): the existing event update trigger now rejects Draft-to-Active transitions with zero tasks. Its restricted security-definer function checks all tasks for the event, so a Co-Admin may launch an event whose only tasks belong to another committee while both existing invariants remain intact.
- **Step 4 — Edit Event** is implemented at `/events/[eventId]/edit`: active Admins and Co-Admins can open Draft/Active events from Home, edit event details, and add/update/delete only the task rows RLS allows them to manage. Task titles/descriptions are loaded through `get_task()`; Co-Admins see an explicit own-committee note and never receive other committees' task rows. Archived events, Members, inactive users, and invalid event IDs are redirected away from the edit page.
- Migration `20261011210000_edit_event_with_tasks.sql` is applied to Dev: `events.updated_at` is the exact optimistic-concurrency token; every successful edit advances it, including task-only saves. The `SECURITY INVOKER` RPC locks and version-checks the event, applies explicit additions/updates/deletions before any Draft-to-Active transition, checks every update/delete row count, preserves omitted tasks and protected task fields, enforces Co-Admin committee scope, and reads the real stored status before allowing deletion of a `To Do` task.
- CodeRabbit follow-up fixes are implemented: Live Operation timestamps now serialize and reload through one shared `Asia/Manila` (`UTC+08:00`, no DST) definition instead of depending on the browser timezone. Existing assignee IDs missing from the active-only picker render as removable `Inactive member` chips without looking up inactive profiles or loosening `users` RLS.
- Migration `20261011220000_allow_existing_inactive_task_assignees.sql` is prepared (not yet pushed): it replaces `edit_event_with_tasks` with the exact same signature, invoker security, lifecycle rules, grants, and revokes. Task additions still require active assignees; task updates may retain an inactive assignee only when that id is already stored on the task, while every newly added assignee must be active and every id must still exist.
- **Step 5 — Template Auto-Import** is implemented on `/events/new`: active Admins can copy all non-confidential tasks visible in an Archived event, while Co-Admins receive only their own committee's tasks through existing RLS. Imported task drafts remain editable, start as `To Do` in the Backlog with no assignees, and preserve null dates while shifting every non-null due/call/end timestamp by the integer day difference between event start dates. The form reports confidential tasks skipped, skips and counts Live Operations whose end schedule cannot be represented exactly by the single-day editor, preserves existing work when a template has no importable tasks, rejects templates over 200 importable tasks, and offers a confirmation-gated re-import after the new start date changes.
- Migration `20261012120000_import_archived_event_template.sql` is prepared (not yet pushed): the fixed-search-path, read-only `SECURITY INVOKER` function rejects inactive or unauthorized callers and non-Archived events, applies task RLS plus an explicit own-committee restriction for Co-Admins to both imported rows and confidential counts, excludes confidential content while reporting its count, and never writes tasks directly. Final saving still goes only through `create_event_with_tasks`.
- **Step 6 — Event Archives** is implemented: `/archives` lists Archived events for active users and links to a read-only event/task record. Every active user can read its non-confidential tasks, while confidential tasks retain their earlier visibility rules. Task cards show primary and assist assignees with names and avatars, keep deactivated assignees' real names, use initials when an avatar is absent or fails to load, and use `Former member` only when no profile row is returned. Home shows an Admin-only Archive action on Active events; its permanent-action confirmation reports the number of non-Completed tasks that will be frozen. The POST-only archive route re-verifies an active Admin, uses the caller's Supabase session (never service role), updates only an expected Active row, and verifies that exactly one row changed.
- Migration `20261012150000_freeze_archived_events.sql` is prepared (not yet pushed): it preserves `created_by` immutability, Active-to-Draft rejection, and the all-committee task requirement for Draft-to-Active; permits only Active-to-Archived; blocks Archived event updates/deletes even for service-role writes; and adds a fixed-empty-search-path, fail-closed security-definer trigger that takes a parent-row share lock before blocking every insert/update/delete involving an Archived event's tasks. Existing Archived read visibility is unchanged. Notification read state remains writable by its owner, and historical activity stays readable because neither operation mutates event/task records.
- Migrations `20261012160000_expand_archived_task_visibility.sql` and `20261012160100_list_archived_event_assignees.sql` are prepared (not yet pushed): the first keeps every existing task-read path and adds active-user access to non-confidential Archived tasks through a restricted parent-status helper that reads independently of caller RLS; the second returns only id, name, and avatar URL for assignees of those tasks, includes users deactivated after assignment, and returns nothing to inactive callers or for non-Archived events. Neither migration changes task writes, `get_task()`, activity-log visibility, or `users` RLS.

Not done: everything after Step 6 in `docs/PHASE-3-PLAN.md` (banner upload, Drive preview). The banner box on the event form remains a placeholder.

## Decisions log

- Magic link remains the required first login; password and Google are optional extras unlocked after it.
- Gmail SMTP (App Password) is the interim email sender; revisit Resend only if the team buys a domain.
- Invites/user management are Admin-only; users are deactivated, never deleted.
- Dev allows `gmail.com` invites for testing; Prod is meant to end up university-domain-only.
- Phase 3 is built one feature at a time: wire an existing HTML prototype to real Supabase data, test it, then move on.
- Event access deliberately differs from the original spec: Drafts are shared among active Admins/Co-Admins, and any of them may edit or launch a Draft; Members never see Drafts, Active events cannot return to Draft, only Admins may archive/delete, and Archived events cannot be un-archived.
- Event task timestamps use `Asia/Manila` (`UTC+08:00`, no daylight saving) for both form serialization and edit-page display, so browser timezone settings cannot shift saved call/end times.
- Launching requires at least one task; saving a Draft with zero tasks is allowed. Phases are stored on task rows, so empty phases are intentionally not persisted.
- Archive-template imports deliberately honor the caller's existing task RLS: Admins receive all committees, Co-Admins receive only their own committee, and confidential tasks are never returned or copied. Imported confidentiality/viewer rules are therefore reset implicitly because only ordinary non-confidential task structure enters the create form.
- Archiving is permanent and limited to Active events. Incomplete tasks do not block it because task status editing belongs to Phase 4; the Admin confirmation reports the incomplete count, and every task is frozen exactly as stored. Archived events cannot be deleted.
- Git flow: one feature branch per task → CodeRabbit → PR → merge → then push the migration to Prod (the owner does all Supabase CLI pushes).

## Status checks (answered 2026-10-10)

- `feature/event-engine` PR merged to `main`: YES
- `tighten_events_insert_policy` migration pushed to Prod: YES
- UI redesign merged and deployed on Vercel, `npm run build` passes: YES
- Leftovers (`sidebar.tsx`, `reset-password-form.tsx`, packages `cn` and `p`) removed: YES
- Service-role key not in any client bundle: YES

Next up after the pending Step 3–6 migrations are reviewed and applied: Phase 3 Step 7 (see `docs/PHASE-3-PLAN.md`).

## Open items

- Tighten `ALLOWED_EMAIL_DOMAINS` on Prod to the university domain only (Vercel env var + redeploy).
- Deactivate the mistyped fake-email test account on Prod (can't delete — by design).
- Banner upload (same crop/compress pattern as avatars, 16:9, 1–1.5 MB) — deferred from Step 1.
- `discord_id` field in Settings — parked until Discord webhooks are scheduled.
- No automated RLS tests yet (the plan calls for a pgTAP/Supabase test suite in CI; only manual `SET ROLE` tests exist).
- `/docs/BACKUP.md` runbook not written (Phase 5).

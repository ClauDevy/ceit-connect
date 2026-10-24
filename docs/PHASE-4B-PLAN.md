# Phase 4B Plan: Modifications Before Phase 5

Phase 4 (Steps 1A to 10) is finished and live on Dev and Prod. Phase 4B is a set of
modifications and a UI redesign that happens before Phase 5 (notifications, Discord,
Executive Dashboard). Phase 5 starts after Phase 4B batches 0 through 14 are merged.
Batch 15 is post-Phase-5 follow-up work and is not part of the Phase 4B completion gate.

## Working rules (same as Phase 4)
- Codex writes a PLAN first, the owner pastes it to Claude for review, then approves.
- Every new migration is read line by line by the owner before `db push` to Dev.
- Never edit a migration already on Dev or Prod; fixes go in a new later-timestamp migration.
- Stage order: push to Dev, SQL tests on Dev, app test, commit, CodeRabbit, PR, merge,
  THEN db push to Prod, then link back to Dev.
- SQL tests are ONE self-contained paste each, Dev only, ending in `raise exception 'TEST RESULTS ...'`.
- Branches use conventional names (`feature/...`, `fix/...`), never "phase" names.
- Security-critical migrations use High reasoning; plans use Medium.
- `docs/DESIGN-SYSTEM.md` is to be written on this docs branch and approved by the owner before batch 2 starts; batch 2 and later UI batches apply it.
- Everything is fixed to Philippine time (Asia/Manila, UTC+08:00). No timezone picker.

## Decisions (made by the owner)
Roles and invites
- Three roles. Admin is the SC President title and keeps `committee_id = null`; the existing `President` row remains in `committees`. Vice Presidents are Co-Admins, and each committee has one Co-Admin/VP when officer caps are enabled. Member is everyone else.
- No "technical person" role. A technical person is a normal Member or Co-Admin of a committee.
  An optional cosmetic title label may come later.
- Admins and Co-Admins are invited through a separate Admin-only "Invite officers" flow
  (role plus committee for Co-Admins, several at once, congratulations email). The normal invite form is Members only.
- Only active Admins through officer RPCs may invite a brand-new Admin/Co-Admin, appoint an active Member as Co-Admin or Admin, return a Co-Admin to Member, move a Member to another committee, or cancel an unaccepted officer invite. A Co-Admin must first return to Member before appointment as Admin. There is no generic role-change operation.
- An Admin steps down only on their own initiative, becomes a Member, chooses a committee, and may do so only while another active Admin exists. Admins cannot demote, deactivate, remove, delete, or anonymize one another. The last active Admin is always protected.
- Year-end handover returns the old Co-Admin to Member and appoints the new active Member, or deactivates the old Co-Admin and invites a new person. One account per person keeps history attached.
- Co-Admins get User Management for their OWN committee: view members, invite Members into it,
  deactivate and reactivate them, edit basic details. They cannot perform officer operations, touch
  Admins or Co-Admins, move people between committees, or delete anyone.
Deleting
- Remove former member: Admin only, only for deactivated accounts. The account is always anonymized,
  never deleted: keep the same UUID and `is_active=false`, ban login, replace Auth and profile email
  with a unique non-routable value, set the name to "Former member", clear the avatar, and remove its
  Storage object. Comments stay, and anonymized accounts cannot be reactivated. Bulk select with
  select all (visible results only), preview, typed confirmation, result report, about 50 per run.
  Users with open tasks are skipped.
- Delete archived events: Admin only, Archived events only, typed confirmation, bulk select with a
  year filter. Drafts can also be deleted. The immutable activity log must be handled in the plan.
Tasks
- Admins and Co-Admins leave a task any time, automatically.
- A Member with no deadline leaves immediately. A Member also leaves immediately only when `due_date > now() + interval '72 hours'`; otherwise they request approval from an Admin or an active Co-Admin whose committee owns the task. The requester may cancel their own pending request.
- An Admin or Co-Admin who volunteers for backup becomes a helper automatically; nobody approves
  their own request. Members who volunteer still need approval from someone else.
- Pickers must hide the acting user and anyone already covered (assignees, people with access,
  volunteers). A read-only loophole audit comes first in the task-rules batch.
- Select-all when assigning exists only as "select all in this committee".
- Draft events: all active Admins and Co-Admins see all tasks and phases; confidential masking still applies and writes stay committee-scoped.
- Invite-only events: not building. Events stay visible to all members.
Activity Log
- Admin and Co-Admin see the whole log (confidential masking still applies); Members see their own
  tasks' history on the task page. Sorting, filters, search, "Load more".

## Batches

Batch IDs are stable. Run order: **0, 1, 2, 3, 3P, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13c, 13d, 13b, 4, 14, then Phase 5, then 15.**

0. `fix/users-authz` - remove direct Co-Admin UPDATE on users; make the invite route and Users page use the active-profile guard; preserve narrow own-profile editing without allowing changes to role, committee, or active state.
1. `fix/ui-bugs` - stable search inputs; whole-box real links and 44px phone targets; first-image crop zoom-out; route-specific skeletons; phone Drive preview; comment-button alignment only; `Asia/Manila` display/parsing audit; unused-package proof; exact lint/navigation/middleware/root-script cleanup. No database changes. See `docs/phase-4b/step-1.md`.
2. `feature/ui-redesign-shell` - once the owner approves `docs/DESIGN-SYSTEM.md`, Batch 2 applies it; add the labeled sidebar,
   top-right header (theme toggle, avatar, name, role), phone avatar menu (full name, role, Settings, Sign out), centered content, Home as events only, contrast, and button hierarchy.
3. `feature/ui-redesign-pages` - look and layout only for Tasks, event board, task page, assignee picker,
   Archives, User Management, Settings, and Create Event. Paging is not part of this batch.
3P. List paging - Home, Archives, My Tasks, and Help Wanted use 20 items plus Load more by fetching 21 and showing 20; fix false Load more. Kanban remains fully loaded.
4. `feature/branding` - runs after batch 13b and before batch 14; add the council shield background
   (scattered, faint, fixed placement), login page treatment, light-mode version, and favicon. Needs a clean shield SVG.
5. `feature/motion-polish` - restrained interaction, page-route, form, card, and first-20-list-item transitions; reduced-motion fallback, measurable phone budget, and no new animation library.
6. `feature/mobile-board` - swipeable columns on phones and independent collapse; task cards remain real links.
7. `feature/accounts-polish` - Active/Deactivated tabs; Users paging; Settings warning dot until a password is set; no temporary password; secure invited-user Google sign-in.
8. `feature/officer-invites` - the six officer operations, always-on last-Admin protection, and OFF-by-default role caps behind `public.app_settings.enforce_officer_role_caps`, all under one advisory lock.
9. `feature/coadmin-user-management`
10. `feature/member-removal` - always anonymize eligible deactivated former members.
11. `feature/event-board-task-actions` - Add and Edit Task on the event page, plus Edit and updated-at information on the task page.
12. `feature/activity-log-page` - masked `list_activity_log()` reader, revoked raw activity-log SELECT, and Activity Log paging.
13. `fix/task-rules` - read-only loophole audit first; approved leave/request/cancel rules plus leadership actions at the top of `/workspace` and on task detail; auto-helper; picker rules; caps of 10 Draft events, 20 pending leave requests, and 20 pending volunteer offers per person.
13b. `feature/phase-completion` - see Updates.
13c. `fix/draft-task-visibility` - all active Admins and Co-Admins read all Draft tasks; confidential masking remains and writes stay committee-scoped.
13d. `feature/event-deletion` - one Admin-only Draft/Archived management page with a year filter; one event requires its name, bulk requires `DELETE <count> EVENTS`; Active deletion stays blocked and activity history keeps task UUIDs without a foreign key.
14. `fix/hardening-gate` - revoke TRUNCATE/REFERENCES/TRIGGER from `authenticated` on events, tasks,
    notifications, and activity_log; tighten the Prod email domain; verify Step 1 cleanup and `/sandbox` removal; update catalogs/allowlists; enable officer caps before final release.
15. `feature/dependencies-v2` - post-Phase-5 follow-up, outside the Phase 4B completion gate: normalized `task_dependencies`, multiple prerequisites, transitive auto-revert of every invalid dependent (including Completed) to the To Do lane tail, an activity entry with the initiating user and automatic-revert reason, and raw forward-status gate regression coverage.

## Open items

See `docs/PROGRESS.md` for the canonical project-wide open-items list.

Parked here only: custom domain and Resend, weekly manual Supabase backups, calendar view
(optional, after Phase 5), and task Realtime (unplanned).

Team confirmations still needed: `allowed_viewers`, backup and volunteers, and late sharing.

## Phase 5 (after Phase 4B batches 0 through 14)
Notifications (bell, Discord webhooks, Resend for critical only), Executive Dashboard, polish.

## Updates (latest decisions)
- No temporary password. "Allow new users to sign up" is disabled in Dev and Prod. Invite email,
  then either Continue with Google or set your own password. `/auth/callback` keeps the session only
  for an active matching profile on an allowed domain, with no password gate and no reliance on
  `app_metadata.provider`. Negative tests cover uninvited, deactivated, profile-less, and wrong-domain users.
  The Settings warning dot reminds users to set a backup password.
- Paging is limited to linear lists. Batch 3P owns Home, Archives, My Tasks, and Help Wanted, using
  fetch 21/show 20 so Load more appears only when another row exists. Users paging is in batch 7,
  Activity Log paging is in batch 12, and Kanban stays fully loaded.
- Phase completion (`feature/phase-completion`): when every task in a named phase is Completed, the phase
  tab shows a check and strikethrough, is collapsed by default, and is read-only (no moves, edits,
  assignment changes, comments, link changes, or task mutations from Edit Event). Edit Event may still save event metadata when it submits no completed-phase task mutation. The `Unphased` bucket never completes or locks. Members can still open its tasks
  to read them. One Reopen RPC moves one chosen task to In Progress. It may be called by any active
  Admin or by the active Co-Admin whose id equals `events.created_by`; if that Co-Admin is inactive,
  only Admins may reopen. The dependency auto-revert path in batch 15 may unlock a phase automatically.
  Needs database rules and tests (High reasoning), planned like the archive freeze.
- Branding assets: the shield SVG is not needed until the branding batch. Sources in order: the
  logo's original vector file, a trace done by Claude, or an online converter after removing the background.
- Codex asks questions: every prompt says "Before planning, ask me up to 5 grouped questions about
  anything unclear or conflicting with the docs." Codex writes the technical step docs, SQL and tests;
  this plan holds only decisions and acceptance rules.

## Audit resolutions (owner-approved 2026-10-24)
- Phase 4 gate: Step 10E must be completed or explicitly waived before any 4B code batch.
- Batch IDs are stable; run order is: 0, 1, 2, 3, 3P, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13c, 13d, 13b, 4, 14, then Phase 5, then 15.
- Security-critical (High reasoning): 0, 7, 8, 9, 10, 12, 13, 13c, 13d, 13b, 15.
- Batch 0 `fix/users-authz`: remove direct Co-Admin UPDATE on users; invite route and Users page use the active-profile guard. Own-profile edit keeps working.
- Batch 0 tests prove own-profile editing cannot change `role`, `committee_id`, or `is_active`.
- Batch 1 first records the exact lint baseline, then fixes those three warnings plus the root-layout development warning. Successful sign-in/password-reset navigation remains tested. After Batch 1 merges, its `cn`/`p`/lint/script items leave `docs/PROGRESS.md`; Batch 14 only verifies they stay gone.
- Users are never deleted or hard-deleted. "Remove former member" (Admin only, deactivated accounts only) anonymizes: same UUID, is_active=false, login banned, auth and profile email replaced with a unique non-routable value, name "Former member", avatar cleared and Storage object removed. Anonymized accounts cannot be reactivated. Bulk select, preview, typed confirmation, result report, about 50 per run; users with open tasks are skipped. Golden rule 9 does NOT change.
- Google sign-in: "Allow new users to sign up" disabled in Dev and Prod. /auth/callback keeps the session only for an active profile whose email matches and is on an allowed domain. No password gate. No reliance on app_metadata.provider. Negative tests: uninvited email, deactivated user, profile-less user, wrong domain.
- Officer operations are exactly: invite a new officer, appoint an active Member, return a Co-Admin to Member, move a Member to another committee, cancel an unaccepted officer invite, and Admin self-step-down. Admin is the President title with `committee_id = null`; the `President` lookup row remains. No Admin alters another Admin.
- Add private `public.app_settings` with RLS and no anon/authenticated grants. `enforce_officer_role_caps` is false in Dev and Prod for testing. Under the shared officer advisory lock, caps-on counts pending invites and permits at most two active Admins and one active Co-Admin per committee. Caps-off permits extra test officers; never-zero stays on. Enabling caps later affects only new invites, appointments, and activations, not existing over-limit accounts.
- Before Step 8 migration design, run the documented read-only Dev/Prod check for any Admin with non-null `committee_id`; a nonzero result requires an owner decision and tracked correction before implementation. Step 8 tests prove both cap modes and activation of caps around existing over-limit accounts.
- Batch 10 typed confirmation is exactly `REMOVE <count> MEMBERS`.
- Batch 11 adds the approved `tasks.updated_at` token: meaningful task-row changes including status advance it; rank-only changes and child-table changes do not.
- Request to leave: `unassign_self` already permits null deadlines or deadlines more than 72 hours away and is extended with requests at/inside the cutoff. Requesters may cancel. Leadership approve/deny appears at the top of `/workspace` and on task detail. No notifications are needed. Approved caps are 10 Draft events per creator, 20 pending leave requests per person, and 20 pending volunteer offers per person.
- Draft event tasks (batch 13c): all active Admins and Co-Admins read all Draft tasks; confidential masking still applies; writes stay committee-scoped.
- Event deletion (batch 13d): one Admin-only management page covers Draft and Archived events with a year filter. Single deletion types the event name; bulk deletion types `DELETE <count> EVENTS`. Active deletion is blocked; activity_log keeps the task UUID without a foreign key.
- Phase completion (batch 13b): completion is derived for named phases only. A completed phase blocks every task/child mutation, while metadata-only Edit Event saves remain allowed. `Unphased` never completes or locks. Reopen moves one chosen task to In Progress and is callable by any active Admin or the active Co-Admin whose id equals events.created_by; if that Co-Admin is inactive, Admins only.
- Paging (batch 3P): 20 items plus "Load more" for linear lists only (fetch 21, show 20). Kanban board stays fully loaded. Home, Archives, My Tasks, Help Wanted in 3P; Users in 7; Activity Log in 12.
- Activity Log (batch 12): list_activity_log() RPC masks confidential content; raw SELECT on activity_log is revoked.
- Catalog: add a new authoritative Phase 4B catalog test after 13b and expand the Step 10 allowlists; old exact counts are historical.
- Batch 14 must enable `public.app_settings.enforce_officer_role_caps` through a tracked migration before final release and verify Step 1's package/lint/root-script cleanup remains complete.
- Batch 5 entrance motion uses only opacity/transform, one fixed duration no longer than 200 ms, no more than the first 20 list items, full reduced-motion fallback, and no new animation library.
- Batch 15 `feature/dependencies-v2` (after Phase 5): normalized task_dependencies table, multiple prerequisites, transitive auto-revert of every invalid dependent to To Do at its lane tail (Completed dependents included), activity entry records the initiating user and an automatic-revert reason. Raw forward-status gate already exists and stays a regression requirement.
- Removed stale items: "raw status gap" (already done) and "two conflicting role/phase breakdowns" (not in repo).
- DESIGN-SYSTEM.md is written in the docs branch (Prompt 3a) and approved by the owner before Batch 2 starts.

# Step 12: Activity Log page

**Status:** Implemented locally; TypeScript, 669 tests, and lint pass; owner browser verification pending | **Branch:** `feature/activity-log-page` | **Reasoning level:** High (security-critical reader, raw-grant removal, and confidential snapshots)

## Goal

Build `/activity-log` as a read-only, paged view of the real task `INSERT`, `UPDATE`, and `DELETE` audit trail. Active Admins and Co-Admins see the whole log, but each entry exposes real task details only when current task-content access is `real`; otherwise it becomes a minimal `Confidential Task` entry. Members receive no global log and may read history only on a task page while they are currently a primary or assist assignee. Replace raw authenticated `activity_log` reads with a fixed-shape masked RPC so Draft and confidential snapshots cannot leak through `changes`.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Decisions (made by the owner): Activity Log

- Admins and Co-Admins see the whole log; confidential masking still applies.
- Members see only their own tasks’ history on the task page.
- The experience includes sorting, filters, search, 20-row cursor block pagination on the global page, and Load more in task History.

### `docs/PHASE-4B-PLAN.md` — Batches and Audit resolutions

- Batch 12 is `feature/activity-log-page` and runs after Batch 11.
- Batch 12 is security-critical.
- Add a masked `list_activity_log()` reader and revoke raw `activity_log` `SELECT` from `authenticated`.

### Owner clarifications for Step 12

- Show only real rows already written by the task activity trigger: task `INSERT`, `UPDATE`, and `DELETE`.
- Support newest/oldest sorting; action, committee, and Philippine-date filters; actor/task/event/committee search; and cursor-backed 20-row three-page blocks without a total count or guessed page cursors.
- Members have history only on `/tasks/[taskId]`, only while they are currently in `primary_assignees` or `assist_assignees`. Ordinary `allowed_viewers`, archive-only viewers, volunteers, and former assignees do not qualify. Access disappears on unassignment.
- Real details appear only when current `task_content_access` is `real`. Every other case returns a minimal `Confidential Task` entry containing only timestamp and action.
- Deleted confidential snapshots fail closed because no current task row remains against which to prove real access.

## Current state

- `activity_log` stores `id`, nullable `task_id`, nullable `user_id`, `action`, raw `changes jsonb`, and `created_at`. `changes` contains complete task snapshots: one row for INSERT/DELETE and `old`/`new` snapshots for UPDATE.
- `log_task_activity()` is a fixed-empty-path postgres-owned `SECURITY DEFINER` trigger function. It records every task insert/delete and every update except one whose only difference is `sort_order`.
- Earlier leak fixes narrowed the original policy for confidential, backup, and Draft snapshots. Batch 12 now removes that policy and all direct client table privileges rather than widening it.
- The fixed-shape reader performs masking in PostgreSQL and never serializes raw `changes`; whole-log cardinality for leadership is separated from current task-content authorization.
- A deleted task’s foreign key becomes null through `ON DELETE SET NULL`. Its old task data remains only inside immutable `changes`, so a reader cannot use a live task row to establish current content access.
- `/activity-log` is implemented for active Admins and Co-Admins with server-prefetched default results, safe filters/search, 20-row cursor block pagination, a mobile-navigation-aware sticky pager, solid semantic icon-and-text action badges and row accents, and accessible expandable real-row summaries with guarded task links. Compact rows align their shared header grid and show the first safe change summary with a remaining-count indicator. Task detail retains its separate task-scoped newest-first Load-more History section for eligible callers.
- The activity prototype contains many records and controls the database does not support. It is a visual reference for responsive table/cards, filters, and empty/loading states—not a source of new audit data.

## Scope: in / out

**In:** fixed-shape `list_activity_log()`; raw authenticated `SELECT` removal; active Admin/Co-Admin whole-log page; current-primary/current-assist task-page history for Members; current-access masking; fail-closed deleted confidential rows; Draft snapshot protection; safe actor/task/event/committee labels; newest/oldest sort; action/committee/Philippine-date filters; safe text search; 20-row global cursor block pagination; task-History Load more; semantic action badges; accessible plain-text change-summary expansion and guarded task links; refresh, loading, empty, and safe error states; desktop table and phone cards following the Design System.

**Out:** auth failures; user-profile or role changes; invitations; event creation/launch/deletion audit; confidential-view audit; IP addresses; device details; fabricated “system” actors; statistics cards; CSV export; retention windows or automatic deletion; restore controls; “Live” or Realtime behavior; notification creation; rewriting historical snapshots; expanding `activity_log.action` beyond `INSERT | UPDATE | DELETE`.

## Database impact

Use the two tracked security-critical Batch 12 migrations: the reader/raw-read removal and the portable final all-privilege revoke. Do not edit either historical leak-fix migration.

Create one authenticated-only, fixed-empty-path, fixed-shape `STABLE SECURITY DEFINER` reader named `list_activity_log(...)`. It derives the caller from `auth.uid()`, requires an active profile, validates every sort/filter/search/limit/cursor input, caps each request at 21 rows, and returns only presentation-safe columns. It must never return the raw `changes` document or an arbitrary caller-selected JSON path.

The reader supports two server-derived scopes:

- **Admin/Co-Admin page scope:** every immutable log row is eligible, independent of committee. For a live task, real details are returned only when `task_content_access_for_user(task_id, caller_id) = 'real'`. `masked` and `hidden` decisions both produce the same minimal row: timestamp, action, and the literal `Confidential Task`, with task/event/committee/actor details and change summaries null. This keeps whole-log cardinality without leaking why access is absent.
- **Member task scope:** `p_task_id` is mandatory, the stored task must exist, the caller must currently appear in its primary or assist array, and current content access must be `real`. The reader then returns only that task’s rows. Any unassigned, formerly assigned, viewer-only, masked, hidden, unknown, or deleted task request fails with one non-distinguishing unavailable result/error and no row count.

For live real-access entries, build a deterministic safe projection from whitelisted snapshot fields and safe profile/event/committee joins. The projection may describe changes to approved task fields, but it must not expose raw arrays, hidden ids, arbitrary JSON, emails, roles, or fields unrelated to the visible summary. Actor display uses only safe profile fields; a null/missing actor is rendered as a neutral unavailable/former actor label without weakening `users` RLS.

For deleted rows, recover only the minimum required classification from the stored delete snapshot. A deleted confidential task is always masked, including for Admin, because no current row exists to prove current real access. A deleted non-confidential row may expose only the whitelisted historical task/event/committee presentation fields that the reader validates from the snapshot; it may not return the full snapshot. Malformed or incomplete legacy JSON fails closed to the minimal masked shape.

Draft rows obey the same current access decision rather than trusting the log snapshot. A Co-Admin therefore cannot use the whole-log page to recover another committee’s Draft content. When Batch 13c later expands current Draft visibility for active Admins/Co-Admins, this reader must inherit only the approved current helper decision; it must not add a parallel Draft exception.

Use a stable `(created_at, id)` keyset cursor in the selected direction. Every query fetches at most 21 matching rows, returns 20, and exposes only a next cursor/`has_more` derived from the extra row. Changing sort, filter, search, scope, or task id resets the loaded pages. Date boundaries are interpreted as Asia/Manila calendar days and converted server-side or through one tested shared timezone contract.

After the function exists, drop the permissive `activity_log_select` policy and revoke direct `SELECT` on `public.activity_log` from `authenticated` (and ensure `PUBLIC`/`anon` have none). Keep table writes unavailable to clients. The trigger function alone retains the ability to insert; nobody receives update, delete, truncate, references, or trigger authority through this batch.

## Page and task-history behavior

- `/activity-log` guards itself with `requireUser()` and `getActiveProfileForRoles(['Admin', 'Co-Admin'])`; Members, inactive users, and profile-less callers are redirected or denied even if the layout also guards navigation.
- Desktop uses a responsive activity table; phones use readable cards. Both use the same server response, ordering, filters, masking, and loaded set.
- Activity Log must use the shared Batch 5 motion kit for stable-ID row reveal, user-selected filter panels, loading/content handoff, and reduced motion; it must add both an automated contract row and a manual browser row without exposing masked data during any transition.
- Search covers only safe normalized actor name, action label, real task title, real event name, and real committee name. Masked fields never enter the searchable document, so search cannot act as a confidential-content oracle.
- Action filters are the three stored values only. Committee filtering applies to real entries using the stored/live committee id; masked entries are included only when the chosen filter can be applied without revealing their hidden committee. Otherwise they remain absent from that filtered result without exposing a count distinction beyond the result itself.
- Date inputs use Philippine calendar dates. Newest is the default; Oldest is the only alternate sort.
- When the visible global page has more results, including the server-provided first page on initial load, the client sequentially prefetches at most two following 20-row pages while the tab is visible. Exact RPC cursor strings make only successfully discovered pages clickable; filter changes cancel the chain, and prefetch failures remain quiet.
- The global pager stays at the bottom of the viewport without overlapping the phone bottom navigation. Its stable-height solid surface keeps the 20-per-page label and known page controls available without scrolling the document or moving it on page changes.
- Manual Refresh and focus refresh refetch only the current global page. There is no Realtime, “Live” badge, or background audit-stream claim.
- `/tasks/[taskId]` adds a read-only History section. Leadership and current assigned Members use the same reader with the exact task scope. The section does not replace comments and has no mutation control.
- A successful assignment change, access change, or focus refresh invalidates/refetches history. If a Member is unassigned, cached rows are cleared before showing the safe unavailable state.

## Guards that must remain true

- Raw `activity_log.changes` never reaches an authenticated client. The RPC is the only client read path.
- Admins and Co-Admins receive the complete sequence of log entries, but not necessarily complete task content. `real`, `masked`, and `hidden` access remain distinct internally while `masked`/`hidden` share one non-leaking output.
- Members have no global log page or broad reader mode. They must be currently primary/assist assigned to the exact requested task and have real content access.
- `allowed_viewers`, archived shares, backup requests, volunteer offers, creator provenance, or earlier assignment do not grant Member history.
- Draft content is never authorized from a historical snapshot. Use the current centralized content-access decision.
- Deleted confidential rows are always minimal. Broken/malformed snapshots fail closed.
- Filters and search run before paging and cannot inspect masked values. Global three-page block navigation and task-History Load more preserve exact cursor strings and never duplicate or skip rows within a settled keyset ordering; the global pager never guesses an undiscovered page.
- Activity rows remain immutable and trigger-written. The feature adds no update/delete/restore/retention path.
- Rank-only changes remain absent from the log. No activity reader or UI reconstructs them.
- Every database result and client request error is checked; UI mutations elsewhere cannot leave history loading indefinitely.

## Security risks

- Returning raw `changes` and masking in React is a direct confidential-data leak. Masking must happen inside the database reader before serialization.
- Granting Co-Admins table `SELECT` to obtain the whole log defeats both leak fixes. Whole-log cardinality and content authorization must be separated in the definer reader.
- Joining through caller-visible `tasks` can drop rows and reveal scope-dependent counts. The reader may inspect protected rows as definer only after authenticating the caller, then independently shapes each result.
- A search predicate evaluated against hidden titles, actors, events, or committees becomes a yes/no oracle. Search only the fields present in that caller’s final safe row.
- Delete snapshots are attacker-influenced historical JSON from legitimate task writes and may predate newer columns. Parse types defensively and fail closed.
- Offset paging can duplicate or skip entries when new audit rows arrive. Use an id-tiebroken keyset cursor and reset on query changes.
- A stale Member cache can preserve history after unassignment. Clear data on unavailable responses and refetch after assignment/access mutations and focus.
- Philippine date filters can shift entries if browser-local midnight is used. Use the shared Asia/Manila definition only.

## Earlier test docs to re-run or update

- Update `docs/PHASE-4-STEP-1A-TESTS.md` activity-log coverage: raw authenticated reads must now be denied for every role, including Admin, and the safe reader replaces policy-based visibility.
- Update `docs/PHASE-4-STEP-10-TESTS.md` and `docs/phase-4/step-10-database-review.md` with the reader signature, raw-SELECT revocation, policy removal, grants, and current function/policy counts. Historical Phase 4 results remain historical.
- Rerun `docs/PHASE-4-STEP-2-TESTS.md` and `docs/PHASE-4-STEP-3-TESTS.md` for board/detail/access-helper and Draft/real/masked parity.
- Rerun `docs/PHASE-4-STEP-5B-TESTS.md` for rank-only activity silence and status activity.
- Rerun `docs/PHASE-4-STEP-7-TESTS.md`, `docs/PHASE-4-STEP-7A-TESTS.md`, and `docs/PHASE-4-STEP-8-TESTS.md` for current confidentiality, assignment/unassignment, backup non-authorization, and activity attribution.
- Rerun `docs/PHASE-4-STEP-7B-TESTS.md` to prove archive-only sharing does not give a Member task-history entitlement and deleted confidential snapshots remain masked.
- Rerun `docs/PHASE-4-STEP-9-TESTS.md` to prove task comments remain separate, do not create task activity rows, and current access changes still revoke child readers consistently.
- Add Batch 12 objects and removed raw grants/policies to the authoritative Phase 4B catalog test scheduled after Batch 13b and Batch 14’s expanded Step 10 allowlists.

## Test deliverable

Create `docs/phase-4b/step-12-tests.md` when the batch lands. Include one self-contained rollback-safe Dev SQL paste ending in the intentional `TEST RESULTS` exception, plus pure response/paging/filter tests and a three-role manual checklist.

Test exact function shape, owner, `STABLE SECURITY DEFINER`, empty `search_path`, authenticated-only execute grant, no overloads, raw table `SELECT` denial, no permissive SELECT policy, trigger-only inserts, and immutable update/delete behavior. Assert the reader returns no raw `changes` field.

Cover active Admin, active Co-Admin, Member, inactive, and profile-less callers across public/confidential tasks, own/other committees, Draft/Active/Archived parents, real/masked/hidden decisions, current primary/assist assignment, allowed-viewer-only access, archive-only access, backup/volunteer state, unassignment, unknown ids, deleted public tasks, deleted confidential tasks, missing actors, and malformed historical JSON.

For each allowed real entry, verify only whitelisted fields and summaries. For every masked case, verify exact nullability and the literal `Confidential Task` plus timestamp/action only. Prove search cannot match hidden task/event/committee/actor values, filters cannot leak masked values, Philippine day edges are correct, newest/oldest ordering is stable by `(created_at, id)`, and 20/21/large pages append without duplicates or gaps.

## Manual checklist

- As an Admin, open `/activity-log`; verify INSERT/UPDATE/DELETE rows across committees, solid semantic icon-and-text badges and row accents, expandable real-row summaries and guarded Open task links, newest/oldest sort, every approved filter, search, Refresh, and 20-row three-page block pagination.
- As a Co-Admin, confirm the page shows the whole sequence. Verify real public/currently authorized entries and minimal `Confidential Task` rows for unavailable confidential or Draft content.
- Search for a known hidden title, event, committee, or actor. Confirm it does not make the masked row discoverable through text matching.
- Create, edit, move, and delete disposable tasks. Confirm meaningful changes appear, rank-only reorder does not, and deleted confidential content is masked.
- On a task page as a currently assigned Member, confirm History appears. Remove the Member from both assignment arrays and confirm cached history disappears and direct reader calls fail.
- As an allowed-viewer-only Member, archive-only viewer, volunteer, former assignee, unassigned Member, inactive user, and profile-less user, confirm task history is unavailable.
- Verify date boundaries using records around Philippine midnight and confirm browser timezone changes do not shift the selected day.
- Confirm there are no statistics, export, retention, restore, auth/user/event audit, IP/device, Realtime, or “Live” features.

## Three-role browser checklist

### Admin

1. Sign in as an active Admin and open `/activity-log`; confirm the default newest-first 20-row page appears, then test oldest-first, each action, committee, date boundary, trimmed search, Clear filters, and Refresh.
2. Confirm entries from all committees appear. Open a real row's task link, and verify unavailable confidential/Draft content stays a minimal `Confidential Task` row with time and action only.
3. Search for a known hidden title, event, committee, and actor; confirm none discovers a masked row. Change several filters quickly and confirm an older response never replaces the current filter result.
4. Confirm Created/Updated/Deleted use equal-weight tonal success/brand/destructive icon-and-text badges and matching green/brand/destructive row accents. Verify the shared header grid aligns with compact rows, task metadata uses a quiet committee chip, masked changes say `Hidden`, and real rows preview the first summary plus any remaining count.
5. Confirm masked tasks remain neutral and cannot expand. Expand real rows by mouse and keyboard, verify plain-text change lists, and verify Open task appears only for valid live task ids and not for DELETE rows. Then open a task and confirm its unchanged History remains newest-first with only Refresh and Load more.
6. With at least 61 matching rows, confirm known page buttons 1-3 appear from the initial server page without first navigating, the right block arrow opens page 4 only after its exact cursor is known, and the next block fills as 4-6. Confirm the sticky pager stays above phone navigation, does not shift while prefetch completes, keeps the old page visible without scrolling while navigating, and resets to page 1 after a filter change.

### Co-Admin

1. Sign in as an active Co-Admin; confirm Activity Log appears in navigation and direct `/activity-log` access succeeds.
2. Confirm the whole-log sequence has the same cardinality as Admin while details are real only where currently authorized; other confidential/Draft rows must be minimal masked entries.
3. Apply committee and search filters and confirm masked rows cannot reveal hidden committee, task, event, or actor data. Verify Philippine date choices do not change after switching the browser timezone.
4. Verify the global pager keeps the current page visible while moving, handles short/empty `has_more` pages, resets on filters, exposes only known pages in three-page blocks, and never skips a page while the next block cursor is still loading. Open an accessible task and verify its unchanged History still uses Refresh and Load more with the same sentinel, cursor, dedupe, and quiet-error rules.

### Member

1. Sign in as an active Member; confirm Activity Log is absent from navigation and direct `/activity-log` access follows the existing denial redirect.
2. Open a task where the Member is currently primary or assist assigned; confirm History appears, is newest-first, and offers only Refresh and Load more.
3. Remove the Member from both assignment arrays in another authorized session, then refocus or refresh the Member tab; confirm cached History clears to the quiet unavailable state without breaking the rest of the task page.
4. Repeat with an allowed-viewer-only, archive-only viewer, volunteer, former-assignee, or unassigned account and confirm History stays unavailable. Confirm masked rows, when present for eligible leadership, show only `Confidential Task`, time, and action.

## Acceptance

`/activity-log` gives active Admins and Co-Admins a stable, searchable, filterable, sorted, 20-row block-paged view of every real task audit row without exposing raw snapshots. Current real access controls details; every unavailable entry is a minimal `Confidential Task` row, and deleted confidential history fails closed. Members have no global page and can read only the selected task’s history while currently primary/assist assigned. Draft content, raw `changes`, rank-only noise, and unsupported prototype features remain absent.

## Open questions for the owner

- None. Any request to add prototype statistics, export, retention, restore, non-task audit categories, or Realtime is new scope and requires a later owner decision.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod status without owner confirmation.
- Add `docs/phase-4b/step-12-tests.md`.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` to replace the raw activity-log policy description with the fixed-shape reader, exact scopes, masking, paging, and grants.
- Update the named Phase 4 activity/catalog tests, then include Batch 12 in the authoritative Phase 4B catalog and final Batch 14 gate.

# Step 3P: List paging

**Status:** Implemented locally; owner gate pending | **Branch:** `feature/list-paging` | **Reasoning level:** Medium

## Goal

Give Home, Archives, My Tasks, and Help Wanted one reliable paging pattern: fetch 21, show 20, and offer **Load more** only when the extra row proves another result exists. Preserve each list's current ordering, filters, access rules, polling behavior, and presentation sections while eliminating the false Load more state.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 3P owns list paging for Home, Archives, My Tasks, and Help Wanted: 20 items plus Load more by fetching 21 and showing 20; false Load more is fixed; Kanban remains fully loaded.

### `docs/PHASE-4B-PLAN.md` — Updates (latest decisions)

- Paging is limited to linear lists. Batch 3P owns Home, Archives, My Tasks, and Help Wanted. Users paging is in Batch 7, Activity Log paging is in Batch 12, and Kanban stays fully loaded.

### `docs/PHASE-4B-PLAN.md` — Audit resolutions

- Paging uses 20 items plus Load more for linear lists only (fetch 21, show 20). Home, Archives, My Tasks, and Help Wanted are in 3P; Users is in 7; Activity Log is in 12.
- All four Step 3P lists keep offset paging with one shared client strategy; do not switch them to keyset paging. Batch 12 Activity Log uses keyset paging under its own contract.

## Current state

- `src/app/(dashboard)/home/page.tsx` makes one direct RLS-backed `events` query for Active and Draft rows, ordered by `start_date ASC` then `created_at ASC`, and only then splits rows into Active and Draft sections. It has no unique final tie-breaker, limit, or paging.
- `src/app/(dashboard)/archives/page.tsx` directly reads all Archived events, ordered by `start_date DESC` then `created_at DESC`, with no unique final tie-breaker or paging.
- `src/lib/tasks/my-tasks.ts` sets `MY_TASKS_PAGE_SIZE = 50`; `src/components/tasks/my-tasks-list.tsx` treats an exact 50-row result as proof of another page. The sole tracked definition, migration `20261022150000_list_my_tasks.sql`, defines `list_my_tasks(text,text,integer,integer)` with offset paging, a 100-row maximum, its existing filter-selected business sort, and final `task_id ASC` tie-breaker.
- `src/lib/tasks/backup.ts` sets `HELP_WANTED_PAGE_SIZE = 50`; `src/components/tasks/help-wanted-list.tsx` has the same exact-page false-positive rule. The sole tracked definition, migration `20261022120000_task_claim_backup_volunteers.sql`, defines `list_help_wanted_tasks(integer,integer)` with offset paging, a 100-row maximum, and `due_date ASC NULLS LAST, task_id ASC` ordering.
- Comments are separate: `src/lib/tasks/comments.ts` uses 25 rows, while migration `20261023130000_task_comments.sql` permits up to 50 and uses keyset paging plus an explicit `out_has_more` result.
- `docs/phase-4/step-10-database-review.md` and `docs/PHASE-4-STEP-10-TESTS.md` record one live signature per Phase 4 function name and zero overloads.

## Scope: in / out

**In:** combined 20-row Home pages while retaining Active and Draft headings; 20-row Archives pages; 20-row My Tasks and Help Wanted pages; 21-row lookahead; the same page-reset and id-deduplicated append strategy for all four lists; current sorting, filters, polling/focus rules, error states, and loaded-count indicators.

**Out:** Kanban paging; Users paging (Batch 7); Activity Log paging, which uses keyset paging in Batch 12; converting any Step 3P list to keyset; new search/filter features; reordered Home statuses; comments, which retain 25-item keyset pages with a maximum of 50; any page not named above.

## Database impact

None expected. The two task readers already accept limits up to 100 and already end every current ordering with unique `task_id`, so callers can request 21 without a function change. Home and Archives use direct RLS-backed event reads and need only an `id` tie-breaker appended in their application queries. No migration, table, policy, grant, or side-by-side RPC replacement is planned.

If an owner-approved server-side search/filter or another discovered requirement changes a reader, add a new tracked migration and `CREATE OR REPLACE FUNCTION` the same signature; never create an overload or edit an applied migration. Preserve owner, volatility, fixed search path, fixed result shape, revokes/grants, caller derivation, authorization, ordering, and error contracts.

## Guards that must remain true

- Fetch 21, expose only 20, and advance by 20 so no row is skipped; the lookahead row must reappear as the first candidate of the next request.
- Every offset ordering ends with a unique stable id after its existing business-sort columns: Home uses `start_date ASC, created_at ASC, id ASC`; Archives uses `start_date DESC, created_at DESC, id DESC`; `list_my_tasks(...)` preserves its selected sort and ends with `task_id ASC`; and `list_help_wanted_tasks(...)` remains `due_date ASC NULLS LAST, task_id ASC`.
- Home, Archives, My Tasks, and Help Wanted all reset to page 1, replace accumulated rows, and clear stale `has_more` state whenever their authoritative source, tab, filter, sort, or query identity changes. Polling/focus refresh of the source also restarts from page 1 rather than appending against an old snapshot.
- On Load more, append only rows whose stable id is not already present. Deduplicate by id across the full accumulated result while preserving the server's established order; never use display text or array position as identity.
- Home uses one combined ordered result, retains its Active and Draft headings, and does not silently introduce status-first ordering.
- My Tasks remains caller-derived, Active-event-only, assignment-scoped, filter/sort aware, and confidential-safe. Help Wanted remains Active/incomplete/current-real-content scoped.
- Poll only the active Workspace tab under the existing visible/focus policy; use the same page-1 reset and id-deduplicated append behavior and disable Load more while unsettled.
- Kanban and comment paging remain unchanged. Batch 12 Activity Log remains a separate keyset-paged list.

## Security risks

- Do not move protected filtering to the client or accept a user id for My Tasks.
- A lookahead row must never be rendered, counted as loaded, or leaked through an accessibility announcement before it becomes part of a visible page.
- Preserve each unique stable id as the final tie-breaker across page boundaries, especially when multiple rows share `start_date`, `created_at`, due date, priority, status, or event name. Offset paging still has a small accepted skip risk when rows are inserted or deleted ahead of a later offset between requests; page-1 resets on source/filter/sort changes and authoritative refresh reduce stale accumulation, while id deduplication prevents repeated cards. Do not describe this as gap-free under concurrent source mutation and do not switch to keyset in this batch.
- Any reader replacement must replace the existing signature and retain zero overloads, grants, active-caller checks, masking, and fixed output shape.

## Earlier test docs to re-run or update

- `docs/PHASE-4-STEP-8-TESTS.md`: TEST 1 catalog/function contract (**19** pinned result lines) and TEST 5 Help Wanted reader behavior (**10**).
- `docs/PHASE-4-STEP-9A-TESTS.md`: TEST 1 catalog (**12**), TEST 2 scope/lifecycle (**14**), TEST 3 sorts/pagination (**16**), and TEST 4 validation/RLS (**13**).
- `docs/PHASE-4-STEP-10-TESTS.md`: 10D-2 pagination/caps (**14**). Its 50/100-row assertions may remain database-contract tests if the readers are unchanged; add 21/show-20 app coverage separately.
- If a reader is replaced, re-run the Step 10A catalog paste and keep its historical inventory at `57 / 8 / 11 / 20 / 0`, especially **0 overload rows**; update the inventory only if later approved migrations legitimately change counts.
- Re-run/update the Workspace manual checks in `docs/PHASE-4-STEP-10E-GATE.md` and the focused tests in `src/lib/tasks/my-tasks.test.ts` and `src/lib/tasks/backup.test.ts`.

## Test deliverable

Create `docs/phase-4b/step-3p-tests.md` when the batch lands. For each of Home, Archives, My Tasks, and Help Wanted, cover 0, 1, 19, 20, 21, 40, and 41 visible-row boundaries; many rows sharing every non-unique business-sort value across a page boundary; exact final-id ordering; exact-multiple false positives; page-1 replacement whenever source/filter/sort/tab identity changes; stable-id deduplication across repeated/overlapping pages; preserved order; retry/loading state; active-tab polling; and the documented small concurrent offset-skip risk. Add a regression assertion that neither task RPC changes or gains an overload, none of the four switches to keyset, and Batch 12 Activity Log retains keyset paging. Run conditional SQL/catalog regression only if a reader changes.

## Manual checklist

- As **Claudee**, **Claude HAAAA**, and **tv**, test every accessible target list at phone width and desktop width in both light and dark themes.
- Home: verify one combined 20-item page, preserved Active/Draft headings and `start_date ASC, created_at ASC, id ASC` ordering, correct continuation after Load more when dates tie, id deduplication, and a page-1 reset after its source changes.
- Archives: verify `start_date DESC, created_at DESC, id DESC` ordering, 20 visible rows, correct continuation when dates tie, correct Load more visibility, working record links, id deduplication, and a page-1 reset after its source or year/filter state changes.
- My Tasks and Help Wanted: verify 20 visible rows, filters/sorts and loaded-count badges, active-tab-only polling/focus behavior, actions, id deduplication after repeated/overlapping loads, and page-1 replacement whenever source, tab, filter, or sort changes.
- For every list, verify empty, error, retry, loading, exact-20, and final-page states; Load more appears only when a 21st row exists and is disabled while loading.
- Simulate an insert/delete ahead of a loaded offset and record the documented small skip risk without claiming gap-free concurrent offset paging.
- Confirm Kanban, Users, and task comments retain their existing loading/paging behavior, and Batch 12 Activity Log retains keyset paging.

## Acceptance

Each named linear list renders offset pages of 20 and shows Load more only when a 21st result exists. Every ordering ends with its unique stable id, including Home and Archives after `start_date` and `created_at`; both existing task RPC definitions already satisfy that invariant and remain unchanged. All four reset to page 1 when source/filter/sort/tab identity changes and deduplicate appended rows by stable id while preserving established order and access rules. The small concurrent offset-skip risk is documented rather than hidden or used to expand scope into keyset paging. Home keeps both section headings, exact multiples do not show a false Load more, Batch 12 Activity Log remains keyset-paged, and out-of-scope lists remain unchanged.

## Open questions for the owner

- `src/app/(dashboard)/home/page.tsx` does not put Active before Draft in its database order; it orders the combined result only by `start_date` and `created_at` before splitting sections. Per owner direction, Step 3P preserves this and does not add status-first ordering. Should a later batch explicitly prioritize Active rows?
- Comments remain an intentional exception to the single 20-item list pattern: 25-item keyset pages, maximum 50. Should they be standardized in a later owner-approved batch?
- No server-side search/filter change is currently required. If implementation discovers one, the owner must approve the reader change and its new replacement migration before it enters this batch.

## Docs to update when this lands

- Mark Step 3P results in this file and `docs/PROGRESS.md` only after implementation and verification, without claiming Dev/Prod status until owner-confirmed.
- Add `docs/phase-4b/step-3p-tests.md`; if a reader changes, update `docs/phase-4/step-10-database-review.md`, the relevant earlier SQL test docs, and Step 10 allowlists/catalog expectations.

## Implementation result

- All four lists now share the same client paging state machine: request 21, expose 20, advance offsets by 20, append with stable-id deduplication, and replace from page 1 after identity, tab, polling, or focus changes. A request token plus `AbortController` prevents an older Load more response from appending after replacement begins.
- Home and Archives retain direct RLS-backed event queries and add only the required final `id` order plus an application range. Home still pages one combined result before rendering its Active and Draft sections; its Edit/Archive capabilities remain server-derived, and Admin incomplete-task counts are requested only for the 20 visible Active events.
- `list_my_tasks` and `list_help_wanted_tasks` are unchanged. Their callers now request 21; the tracked readers still accept up to 100 and retain final `task_id ASC` ordering. No migration, policy, grant, table, reader, or Supabase change was made.
- List reads retry once. Volunteer and withdraw writes are still invoked exactly once and never automatically retried. Only the active visible Workspace tab polls; mutations pause polling until the action finishes and the active list refreshes from page 1.
- The owner requested that Codex not run the gate. Automated, build, lint, and manual verification therefore remain pending and are recorded in `step-3p-tests.md` without claiming Dev or Prod status.

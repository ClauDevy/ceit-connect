# Step 3P: List paging test ledger

**Implementation:** complete locally on `feature/list-paging`  
**Verification:** pending owner-run gate; Codex did not run tests, build, lint, SQL, or Supabase commands  
**Database impact:** none

## Automated coverage added or updated

- `src/lib/list-paging.test.ts` covers 0, 1, 19, 20, 21, 40, and 41-row boundaries; exact-multiple false positives; the 21st-row lookahead; offsets 0/20/40; stable-id ordering and deduplication; page-1 replacement; retry preservation; visible active-tab polling; accessible announcements; and ignored late page-two responses after poll, focus, tab, or identity replacement.
- `src/lib/events/list-paging.test.ts` pins Home to `start_date ASC, created_at ASC, id ASC`, Archives to `start_date DESC, created_at DESC, id DESC`, and verifies that Home splits one combined ordered result without adding status-first ordering.
- `src/lib/list-paging-contracts.test.ts` asserts that all four list clients use the shared paging strategy, reads the tracked migrations, and pins one definition apiece for `list_my_tasks` and `list_help_wanted_tasks`, their 100-row limit acceptance, and final task-id ordering. It also asserts that Batch 3P added no list-paging migration.
- `src/components/shared/load-more-control.test.tsx` checks that no control is rendered without proven lookahead and that ready, loading, retry, and final states keep one accessible button, including disabled and announcement states.
- `src/lib/tasks/my-tasks.test.ts` now pins the app request to 21 and visible page size to 20. `src/lib/tasks/backup.test.ts` pins the Help Wanted request to 21 with offsets advancing by 20. Existing data, confidentiality, assignment, lifecycle, permission, and error assertions were not weakened.

The owner should run the normal repository gate. Re-run the existing Phase 4 Step 8, Step 9A, and Step 10D database suites only as regression evidence; Batch 3P changes no SQL reader. Preserve the historical `57 / 8 / 11 / 20 / 0` Step 10A inventory and zero-overload result.

## Manual Dev fixtures

Use Dev only. Reuse existing records first and create only the shortfall through the app. Prefix every new record exactly as shown, leave it in place, and do not use SQL cleanup, a migration, or any Supabase CLI command. Batch 13d event deletion can remove these fixtures later.

Create only these fixtures:

1. **Home/Archives event set:** count reusable Active/Draft and Archived events first. Through the app, create the minimum shortfall needed so one target list has **21 total accessible events**. Name new records `PAGING-TEST EVENT 01`, `PAGING-TEST EVENT 02`, and so on; give tied records the same start date to exercise the final-id tie-breaker. Keep enough Active/Draft records to test Home, then archive only the minimum needed to put Archives just over 20 for one Load more click. Each launched event needs one ordinary non-confidential task named `PAGING-TEST EVENT TASK 01`, incrementing with the event number.
2. **My Tasks set:** create one Active event named `PAGING-TEST MY TASKS` if no suitable reusable event exists. Add only the shortfall to reach **21 accessible assigned tasks**, named `PAGING-TEST MY TASK 01` through the required final number. Use the same due date, status, and priority on several tasks, assign Claudee, Claude HAAAA, and tv where the app permits, and keep content non-confidential unless an existing confidential record is being used to verify masking.
3. **Help Wanted action fixture:** create one incomplete, non-confidential task named `PAGING-TEST HELP ACTION 01` in an Active event, leave tv unassigned, and request backup. One fixture is enough: exact Help Wanted boundaries are automated. Use it to verify tv volunteers once and withdraws once; neither write should repeat automatically.

Before making the My Tasks fixture, ask the owner whether the existing archived-event template import is the preferred safe way to create many task drafts quickly. Do not create 21 new Archived events for manual boundary testing.

## Manual checklist

Run every applicable check as **Claudee (Admin)**, **Claude HAAAA (Co-Admin)**, and **tv (Member)** on desktop and phone widths in both light and dark themes.

- **Home:** confirm at most 20 combined events initially; Active and Draft headings, counts, Batch 3 card treatments, bounded 16:9 banners, Edit visibility, and Admin-only Archive behavior remain correct. Confirm only visible Active cards affect Admin incomplete-task counts. Load once, verify no duplicate, and confirm the continuation follows `start_date`, `created_at`, then `id` without status-first ordering.
- **Archives:** with just over 20 reusable-plus-fixture events, confirm 20 compact rows initially, bounded 16:9 tiles, working record links, one Load more click, descending `start_date`, `created_at`, then `id`, no duplicate, and no second false Load more.
- **My Tasks:** confirm the first 20 compact rows, status and Deadline/Priority/Event sort resets, loaded-count badge, one Load more click, stable focus, and no lookahead title in the DOM, badge, or screen-reader announcement.
- **Help Wanted:** confirm only the active tab polls, switching tabs replaces from page 1, compact rows remain intact, the single volunteer and withdraw each execute once, and the list refreshes from page 1 afterward. A hidden Workspace tab must not poll.
- **All four:** verify hover, focus-visible, pressed, disabled/loading, retry, and final “All items loaded” states. Keyboard focus stays on the same Load more control. During a Load more request, trigger a focus refresh or switch Workspace tabs and confirm a late page-two response never appends to the replacement list.
- Confirm Kanban, including its compact 16:9 hero and phase controls, task comments, and Users behave exactly as before. Do not add paging to them.

The exact 20/21/40/41 boundaries, duplicate overlap, identity reset, and no-false-Load-more cases rely on automated tests; manual fixture creation intentionally stops at just over 20.

## Accepted offset risk

Offset paging can skip a row if an item is inserted or deleted ahead of a later offset between requests. Page-1 authoritative refreshes and id deduplication reduce stale or duplicate display but do not make offset paging gap-free. This accepted risk does not justify switching these four lists to keyset paging; Batch 12 Activity Log keeps its separate keyset contract.

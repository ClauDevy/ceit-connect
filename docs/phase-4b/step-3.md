# Step 3: UI redesign pages

**Status:** Part A implemented and verified locally; Parts B-D pending | **Branch:** `feature/ui-redesign-pages` | **Reasoning level:** Medium

## Goal

Apply the approved design system to the named authenticated pages after the shell is complete. This batch changes look and layout only: it must preserve every reader, writer, permission boundary, lifecycle rule, and existing interaction.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Working rules

- `docs/DESIGN-SYSTEM.md` is approved before Batch 2 starts, and Batch 2 and later UI batches apply it.
- Everything is fixed to Philippine time (`Asia/Manila`, UTC+08:00). No timezone picker.

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 3 is `feature/ui-redesign-pages`: look and layout only for Tasks, event board, task page, assignee picker, Archives, User Management, Settings, and Create Event. Paging is not part of this batch.
- Apply the Design System destructive-action rule: per-item Archive, Deactivate, Remove, and Delete actions live in menus and still require confirmation. Bulk and typed-confirmation actions remain buttons that open confirmation. Specifically, Step 1 only aligns comment Edit/Delete; Batch 3 moves per-comment Delete into the menu without changing who may delete.
- Owner-approved addition: work-link Remove moves into its per-item menu and gains a simple `Remove this link?` confirmation. Cancel performs no mutation; Remove uses the unchanged capability, writer, busy state, and safe errors exactly once.

### `docs/PHASE-4B-PLAN.md` — Audit resolutions

- Batch IDs and run order are stable. Paging for Home, Archives, My Tasks, and Help Wanted belongs to Batch 3P; Users belongs to Batch 7; Activity Log belongs to Batch 12; Kanban stays fully loaded.

## Current state

- Tasks uses `src/app/(dashboard)/workspace/page.tsx` with `src/components/tasks/workspace-tasks.tsx`, `my-tasks-list.tsx`, and `help-wanted-list.tsx`.
- The event board uses `src/app/(dashboard)/events/[eventId]/page.tsx` and `src/components/events/event-board.tsx`; it reads through `list_event_board_tasks`, last ordered by migration `20261018140000_order_event_board_by_sort_order.sql`.
- Task detail and people controls live in `src/app/(dashboard)/tasks/[taskId]/page.tsx`, `src/components/tasks/task-detail.tsx`, and `task-people-controls.tsx`. Their current contracts come from migrations through `20261023160000_archived_task_viewers.sql`.
- Archives, User Management, Settings, and Create Event are at `src/app/(dashboard)/archives/page.tsx`, `users/page.tsx`, `settings/page.tsx`, and `events/new/page.tsx`; shared primitives are in `src/components/ui` and `src/components/shared`.
- Relevant sections were searched in `docs/prototypes/tasks.html`, `event.html`, `archive.html`, `user-management.html`, `settings.html`, `create-event.html`, and `style.css`; no prototype file was read wholesale.

## Scope: in / out

**In:** visual hierarchy, spacing, responsive layout, cards/tables, page headers, filters and pickers already supported today, empty/loading/error presentation, consistent semantic component use, and the approved per-item destructive-action menu placement on the eight named surfaces.

**Out:** paging; new or changed search/filter behavior; new actions; mobile swipe/collapse board behavior; reader or writer changes; permission, RLS, lifecycle, polling, or data-shape changes; pages outside the named list.

## Database impact

None. No migration, table, function, policy, or grant changes are expected. If the approved layout cannot be delivered without a reader change, stop and return that need to the owner rather than adding it to this batch.

## Guards that must remain true

- Every page keeps its own current auth/role guard; UI visibility remains only UX.
- Confidential titles/descriptions continue through `get_task`; masked shells reveal no protected metadata.
- Draft, Active, and Archived behavior; committee scope; task movement; assignments; archive sharing; comments; work links; and event creation rules remain unchanged.
- Kanban remains fully loaded, and all existing fetch errors and mutation busy states remain handled.
- Moving a destructive control into a menu does not change capability checks, confirmation, payloads, pending state, safe errors, or authoritative refetch behavior. Bulk/typed-confirmation controls remain buttons.

## Security risks

- A redesign must not mount hidden controls or preload protected picker rows for unauthorized users.
- Do not replace capability-driven controls with client role guesses.
- Preserve safe error mapping, server-derived IDs, active-user checks, and confidential masking when rearranging components.

## Earlier test docs to re-run or update

- Re-run the relevant manual sections of `docs/PHASE-4-STEP-6-TESTS.md`, `PHASE-4-STEP-7-TESTS.md`, `PHASE-4-STEP-7A-TESTS.md`, `PHASE-4-STEP-7B-TESTS.md`, `PHASE-4-STEP-8-TESTS.md`, `PHASE-4-STEP-9-TESTS.md`, `PHASE-4-STEP-9A-TESTS.md`, and `PHASE-4-STEP-10E-GATE.md`.
- SQL pastes remain unchanged because this batch must not change database contracts.

## Test deliverable

Create `docs/phase-4b/step-3-tests.md` when the batch lands. Record automated verification plus a page-by-page three-role visual and regression checklist, explicitly confirming no data or permission change.

## Manual checklist

- As **Claudee**, **Claude HAAAA**, and **tv**, check every page each account can access at desktop and phone width in both light and dark themes.
- Tasks: verify tabs, existing filters/sorts, counts, actions, loading/error states, and current 50-row behavior are functionally unchanged.
- Event board and task page: verify masked/real content, lanes, drag/Move controls, task actions, assignee picker, links, comments, and Archived read-only states retain current permissions. Confirm per-comment Delete is in its menu with confirmation while Edit remains correctly aligned and capability-driven.
- Archives, User Management, Settings, and Create Event: verify responsive cards/tables/forms/dialogs, labels, focus, error/empty/loading states, and role-specific controls without horizontal overflow.
- Home: verify Active cards keep the capability-driven Edit/Admin-only Archive menu and clear board affordance, while compact Draft cards use a visible supporting Edit action with no menu. Existing capability checks and the archive confirmation/request contract remain unchanged.
- Edit Event shares `event-form.tsx` with Create Event and is included in the same visual and regression checks.

## Acceptance

All named pages match the approved design system at phone and desktop widths in both themes. Existing operations and access decisions behave exactly as before, paging is untouched, Kanban remains fully loaded, and no database or reader change is introduced.

## Open questions for the owner

- None. Any discovered need for a reader, database, permission, or behavior change must be brought back here for owner approval rather than absorbed into this visual batch.

## Implementation results

- **Part A is implemented and verified locally.** `docs/DESIGN-SYSTEM.md` now records its owner-approved status and reusable surface rules. Home keeps its events-only layout and capability conditions while placing Edit and Admin-only Archive in one readable corner menu; viewers with neither action receive no trigger, and Archive opens the unchanged confirmation and request flow.
- Settings retains independent Profile, Profile Photo, and Password flows in a centered, at-most-two-column layout. All three cards share one width, password fields fill their card, the skeleton matches, and Profile Save retains its explicit unchanged/unsaved state and existing validation, RPC, safe errors, refresh, and duplicate-submit protection.
- The shared Create/Edit Event form now has clearer starting-mode selection, setup tabs, section and phase hierarchy, and assignee selection states. Its desktop summary is sticky with reachable overflow, its phone layout remains stacked, and Cancel lives below the summary actions while the status badge stays in the Edit header. All fields, validation, payloads, readers, writers, confidentiality path, permissions, and create/edit behavior remain unchanged.
- Local verification passes 27 Vitest files / 267 tests, the Next.js 16.3.4 production build with all 23 routes, and lint with zero errors or warnings. Real-browser account/theme/width checks remain pending in `docs/phase-4b/step-3-tests.md`.
- The owner follow-up is included in that verification: Settings uses the approved centered equal-width layout, Home uses one capability-driven corner menu, and the shared event summary is sticky only at desktop widths. `git diff --check` also passes with only Windows line-ending notices.
- The second owner follow-up restores the earlier compact dashed Draft-card treatment while retaining its per-event menu, adds semantic sticky shell-header surfaces, and polishes the shared task editor with grouped content, a local native-radio task-type control, visible pinned validation/actions, quiet removal controls, icon-and-text status chips, and static existing tiger artwork. The shared sign-in segmented control is intentionally untouched.
- Follow-up 2 local verification passes all 267 Vitest tests across 27 files, the Next.js 16.3.4 production build with all 23 routes, lint with zero errors or warnings, and `git diff --check`. An explicit no-diff check against `HEAD` also proves the shared segmented control and sign-in panel are unchanged.
- Follow-up 3 Stage 1 raises the sidebar collapse control above the sticky desktop header, keeps Active event actions in their menu, gives Active cards a clear board affordance, and restores visible capability-driven Edit on compact Draft cards alongside “Not launched” and safe server-rendered last-edited metadata. No Home reader or permission changed because `updated_at` was already selected.
- Stage 1 verification passes all 267 Vitest tests across 27 files, the Next.js 16.3.4 production build with all 23 routes, and lint with zero errors or warnings. Its scoped whitespace check passes; the full check remains red only for unrelated `docs/prototypes/index.html:336` trailing whitespace, which this batch does not touch.
- Parts B-D have not started. No database, migration, RLS, grant, Supabase CLI, deployment, commit, or push work was performed.

## Docs to update when this lands

- Mark Step 3 results in this file and `docs/PROGRESS.md` only after implementation and verification; distinguish local, Dev, and Prod status using owner confirmations.
- Add `docs/phase-4b/step-3-tests.md`; update `docs/DESIGN-SYSTEM.md` only for owner-approved reusable rules.

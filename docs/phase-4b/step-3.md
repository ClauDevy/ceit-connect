# Step 3: UI redesign pages

**Status:** Planned | **Branch:** `feature/ui-redesign-pages` | **Reasoning level:** Medium

## Goal

Apply the approved design system to the named authenticated pages after the shell is complete. This batch changes look and layout only: it must preserve every reader, writer, permission boundary, lifecycle rule, and existing interaction.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Working rules

- `docs/DESIGN-SYSTEM.md` is approved before Batch 2 starts, and Batch 2 and later UI batches apply it.
- Everything is fixed to Philippine time (`Asia/Manila`, UTC+08:00). No timezone picker.

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 3 is `feature/ui-redesign-pages`: look and layout only for Tasks, event board, task page, assignee picker, Archives, User Management, Settings, and Create Event. Paging is not part of this batch.
- Apply the Design System destructive-action rule: per-item Archive, Deactivate, Remove, and Delete actions live in menus and still require confirmation. Bulk and typed-confirmation actions remain buttons that open confirmation. Specifically, Step 1 only aligns comment Edit/Delete; Batch 3 moves per-comment Delete into the menu without changing who may delete.

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

## Acceptance

All named pages match the approved design system at phone and desktop widths in both themes. Existing operations and access decisions behave exactly as before, paging is untouched, Kanban remains fully loaded, and no database or reader change is introduced.

## Open questions for the owner

- None. Any discovered need for a reader, database, permission, or behavior change must be brought back here for owner approval rather than absorbed into this visual batch.

## Docs to update when this lands

- Mark Step 3 results in this file and `docs/PROGRESS.md` only after implementation and verification; distinguish local, Dev, and Prod status using owner confirmations.
- Add `docs/phase-4b/step-3-tests.md`; update `docs/DESIGN-SYSTEM.md` only for owner-approved reusable rules.

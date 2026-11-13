# U2 — Event board component split

## Status

Implemented locally. This is a UI-only refactor with no migration, RPC, route,
authorization, database, or public-prop change. The Stage A/A2 characterization
file `src/components/events/event-board.test.tsx` remained unchanged in Stage B.

## Contract

- Preserve `EventBoardProps`, query keys, RPC arguments, optimistic updates,
  rollback, claim, Undo, polling/focus reconciliation, and all authorization.
- Preserve hook order in `BoardContents`; do not add memoization.
- Preserve the exact rendered DOM, element keys, mobile layout, shared motion,
  focus behavior, safe-area classes, and reduced-motion behavior.
- Keep `phaseMotionKey` on `TabPanel` and `dndContextKey` on `DndContext`.
- Use plain individual props. No wrapper prop objects, custom hook result
  objects, component-local component declarations, `React.memo`, new
  `useMemo`, or new `useCallback`.

## Target file map and line counts

| File | Responsibility | Lines | Over 400 |
| --- | --- | ---: | --- |
| `event-board.tsx` | State, hooks, queries, mutations, event handlers, composition, provider | 959 | **Yes** |
| `event-board-types.ts` | Shared board/component types | 35 | No |
| `event-board-helpers.ts` | Date, phase, and task-count helpers | 41 | No |
| `event-board-primitives.tsx` | Priority choices and lane drop zone | 89 | No |
| `event-board-header.tsx` | Back link, event summary, warnings, errors | 138 | No |
| `event-board-phase-controls.tsx` | Phase tabs, filters, Reopen, Add Task, backlog trigger | 364 | No |
| `event-board-lanes.tsx` | Empty/loading states, completed disclosure, DnD lanes and overlay | 383 | No |
| `event-board-dialogs.tsx` | Backlog sheet, task dialog, Undo notices | 192 | No |

`event-board.tsx` remains over 400 lines because the approved split deliberately
keeps all stateful hook and mutation orchestration together so hook order and
behavior remain auditable. Every new extracted file is under 400 lines.

## Moved-code map

| Original area | New file | Verbatim movement and non-verbatim edits |
| --- | --- | --- |
| Props and mutation context types | `event-board-types.ts` | Definitions moved; imports added. `TaskDialogState` names the existing inline union for prop plumbing. |
| Date/phase/count helpers | `event-board-helpers.ts` | Bodies moved; imports added. |
| `PriorityChoices`, `BoardLaneDropZone` | `event-board-primitives.tsx` | JSX and keys moved verbatim; imports added and `children` typing retained. |
| Back link, event card, archive warning, move/query errors | `event-board-header.tsx` | JSX moved verbatim. Non-verbatim edits are the component boundary, imports, individual scalar props, and callback props for Dismiss/Retry. |
| Phase tabs, priority/committee filters, Reopen, Add Task, backlog trigger, committee note | `event-board-phase-controls.tsx` | JSX moved verbatim. Non-verbatim edits are imports, individual props, and passing the existing inline Reopen refresh/reveal callbacks from `BoardContents`. |
| Loading/empty states, phase notices/disclosure, `TabPanel`, `DndContext`, lanes, mobile indicator, `DragOverlay` | `event-board-lanes.tsx` | JSX, DOM, keys, and motion props moved verbatim. Non-verbatim edits are imports and individual props for existing values/handlers. |
| Backlog `Sheet`, `ActiveTaskDialog`, Undo notices | `event-board-dialogs.tsx` | JSX, DOM, keys, and focus/safe-area props moved verbatim. Non-verbatim edits are imports, a structural Undo-state prop type, and individual props. |
| `BoardContents` render | `event-board.tsx` | Replaced moved JSX with four top-level component calls. Imports were reduced/added; existing values and handlers are passed individually. Stateful logic and hook bodies remain in place. |

No new wrapper elements were introduced: each extracted section that needs
multiple siblings returns a Fragment, and the original outer `space-y-6` div
remains the only composition wrapper.

## Hook-order proof

| Order | Before split (`event-board.tsx`) | After split (`event-board.tsx`) |
| ---: | --- | --- |
| 1 | `useSensors` / `useSensor` | `useSensors` / `useSensor` (line 274) |
| 2 | `finishDragSession` callback | `finishDragSession` callback (line 281) |
| 3 | `cancelActiveDrag` callback | `cancelActiveDrag` callback (line 298) |
| 4 | completed-phase reconciliation effect | completed-phase reconciliation effect (line 303) |
| 5 | mobile lane observer effect | mobile lane observer effect (line 323) |
| 6 | stale-drag cancellation effect | stale-drag cancellation effect (line 373) |
| 7 | resize/orientation/pagehide/visibility effect | resize/orientation/pagehide/visibility effect (line 388) |
| 8 | `useMutation` | `useMutation` (line 417) |
| 9 | Undo timer effect | Undo timer effect (line 501) |
| 10 | filter outside-click/Escape effect | filter outside-click/Escape effect (line 517) |

The filter-effect dependency list remains exactly
`[priorityOpen, committeeOpen]`.

## Tests changed only because of file moves

All assertions in these five source-reading tests are byte-for-byte unchanged.
Only their file-read/source-assembly definitions changed:

| Test | Old file-read line | New file-read line(s) |
| --- | --- | --- |
| `active-task-ui-contract.test.ts` | `const board = readFileSync("src/components/events/event-board.tsx", "utf8");` | `const board = [readFileSync(".../event-board.tsx"), readFileSync(".../event-board-phase-controls.tsx"), readFileSync(".../event-board-lanes.tsx")].join("\n");` |
| `mascot-card-contract.test.ts` collapse row | `const board = read("src/components/events/event-board.tsx");` | `const board = read("src/components/events/event-board-lanes.tsx");` |
| `mascot-card-contract.test.ts` filters row | `const board = read("src/components/events/event-board.tsx");` | `const board = [read(".../event-board.tsx"), read(".../event-board-phase-controls.tsx")].join("\n");` |
| `motion.test.ts` | `resolve(process.cwd(), "src/components/events/event-board.tsx")` | `resolve(process.cwd(), "src/components/events/event-board-lanes.tsx")` |
| `active-task-ui.test.ts` | `readFileSync("src/components/events/event-board.tsx", "utf8")` | `[readFileSync(".../event-board.tsx"), readFileSync(".../event-board-phase-controls.tsx")].join("\n")` |
| `mobile-board.test.ts` | `readFileSync(resolve(process.cwd(), "src/components/events/event-board.tsx"), "utf8")` | `[readFileSync(resolve(..., "event-board.tsx")), readFileSync(resolve(..., "event-board-lanes.tsx"))].join("\n")` |

## Automated test plan and results

- `npx.cmd tsc --noEmit`: passed after correcting split-only imports.
- `npm.cmd run test`: 1,387 passed and 3 failed across 132 files. The three
  failures are the unchanged, previously known CRLF-sensitive J1 source
  contracts in `mention-comment-target-migration-contract.test.ts`.
- Frozen Stage A/A2 board suite: passed 14/14 unchanged.
- `npm.cmd run lint`: exited zero with the unchanged `INK` unused-variable
  warning in `src/components/ui/mascot.tsx`.
- `git diff --check`: passed after removing one split-generated trailing blank
  line; the working-copy LF-to-CRLF notice is informational.

## Full regression and manual checklist

- Desktop pointer drag, touch drag, and keyboard drag; same-lane reorder and
  cross-lane move; collapsed-lane tail drops; no stale drag after refresh.
- Phone horizontal lane snapping, active-column announcement, lane collapse,
  safe-area clearance, DragOverlay sizing, and DnD remount behavior.
- Polling, focus recovery, other-user updates, phase completion during drag,
  stale-session cancellation, mutation locks, and authoritative reconciliation.
- Successful move, exact RPC arguments, optimistic placement, failed-move
  rollback and mapped error, concurrency/offline failure, Undo offer, Undo RPC,
  Undo success/failure, and expiry boundary.
- Add Task and Edit Task dialogs: open/close/focus return, all fields,
  validation, successful save, failed save, confidential/locked combinations,
  Draft/Archived restrictions, keyboard use, and reload behavior.
- Backlog sheet: trigger count/accessible name, responsive placement, focus
  trap/return, close controls, task list, priority-empty copy, Claim RPC,
  Claim success/failure, and volunteer/backup states.
- Priority and committee filters: mouse/keyboard selection, Escape/outside
  click, focus return, clear behavior, overlay, Admin/non-Admin variants, and
  filtered empty states.
- Completed phases: checked/struck tabs, disclosure collapse/expand, inert
  cards, Reopen dialog/candidates/RPC, refresh, revealed tab focus, and
  incompatible dialog/Undo cancellation.
- Event summary, progress count/ring, archive warning, query retry, move-error
  dismiss, phase tabs/counts, backlog-only/mixed notices, and no-task states.
- Base UI dialog, menu, and sheet focus/close/placement behavior at desktop and
  phone sizes, including reduced motion and safe areas.
- Verify unchanged DOM hierarchy, element keys, ARIA relationships, tab order,
  visual layout, shared motion durations, and complete reduced-motion fallback.

Items intentionally left manual because deterministic unit coverage would not
faithfully exercise browser geometry, real pointer/touch/keyboard sensors,
Base UI focus management/placement, CSS safe areas, or multi-client timing.

## Unrelated observations

These pre-existing findings were not changed:

- three J1 source-contract assertions are CRLF-sensitive;
- `src/components/ui/mascot.tsx` has an unused `INK` lint warning;
- `archived-task-list.test.tsx` emits React's warning that `interactive={true}`
  reaches a non-boolean DOM attribute in its test render.

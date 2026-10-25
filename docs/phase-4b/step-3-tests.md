# Step 3 tests: UI redesign pages

**Branch:** `feature/ui-redesign-pages`
**Status:** Parts A-C and D1 automated gates passed locally; D2 is implemented with its owner-run gate and real-browser checks pending
**Database impact:** None. No SQL, migration, RLS, grant, reader, writer, or Supabase command is part of this batch.

## Automated gate by part

### Part A - Home, Settings, and Create/Edit Event

- `npm test` - passed: 27 files, 267 tests.
- `npm run build` - passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` - passed with zero reported errors or warnings.
- `git diff --check` - passed; Git reported only the repository's Windows LF-to-CRLF working-copy notices.
- Part A follow-up 2 reran the full gate with the same result: 27 files / 267 tests, Next.js 16.3.4 with all 23 routes, zero-warning lint, and a passing whitespace check.
- Follow-up 3 Stage 1 passes 27 files / 267 tests, the Next.js 16.3.4 production build with all 23 routes, and zero-warning lint. The Part A application-file scoped whitespace check passes. Commit `3b38c5c` also contains reference-only `docs/prototypes/**` changes that are not shipped application code or covered by the application gate; `git show --check 3b38c5c` reports trailing whitespace at `docs/prototypes/index.html:336`.
- The Part A CodeRabbit follow-up reran the application gate successfully: 27 files / 267 tests, the Next.js 16.3.4 production build with all 23 routes, and zero-warning lint. The final uncommitted-diff whitespace result is recorded with the follow-up handoff.
- `git diff --exit-code HEAD -- src/components/ui/segmented-control.tsx src/components/auth/sign-in-panel.tsx` passed with no output. The sign-in segmented control and its caller therefore retain the exact tracked markup, native keyboard behavior, and sizes; the event task-type radio segments are local to `event-form.tsx`.
- On this Windows machine the package scripts were invoked through `npm.cmd` because PowerShell blocks `npm.ps1`; the package scripts themselves are unchanged.

### Part B - Tasks workspace and task detail

- `npm test` - passed: 27 files, 267 tests. No test file or assertion changed.
- `npm run build` - passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` - passed with zero reported errors or warnings.
- `git diff --check` - passed; Git reported only the repository's Windows LF-to-CRLF working-copy notices.
- `git diff --exit-code HEAD -- src/components/ui/segmented-control.tsx src/components/auth/sign-in-panel.tsx` passed with no output.
- Visual follow-up 1 reran the same gate successfully: 27 files / 267 tests, the Next.js 16.3.4 production build with all 23 routes, zero-warning lint, and `git diff --check`. No test file or assertion changed.
- Follow-up inspection confirms the lifted status/sort state preserves selections across My Tasks → Help Wanted → My Tasks switches; the query key, RPC argument builder, validators, active-only polling, pagination offsets, and 50-row page size are unchanged. Help Wanted mounts no new filter or sort control.

### Part C - Event board

- `npm test` - passed: 29 files, 274 tests. C2-B changed no test file or existing assertion.
- `npm run build` - passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` - passed with zero reported errors or warnings.
- `git diff --check` - passed; Git reported only Windows LF-to-CRLF working-copy notices.
- The progress-ring and shared-priority tests from the earlier Part C stages remain in the passing suite.

### Create/Edit task-dialog follow-up - Stages 0-2

- `npm test` - passed: 29 files, 274 tests. No test file or existing assertion changed.
- `npm run build` - passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` - passed with zero reported errors or warnings.
- `git diff --check` - passed; Git reported only Windows LF-to-CRLF working-copy notices.
- No reader, writer, RPC payload, permission, RLS, validation, polling, data shape, migration, or Supabase operation changed. Batch 3H is documentation-only in this follow-up.

### Part D

- **D1 Archives:** owner-verified and committed after `npm test` passed 30 files / 276 tests, the Next.js 16.3.4 production build completed all 23 routes, lint reported zero errors or warnings, and `git diff --check` passed with Windows line-ending notices only.
- **D2 User Management:** implemented locally. Per owner instruction, Codex did not run `npm test`, `npm run build`, `npm run lint`, or `git diff --check`; add the owner's exact results after they run the gate.
- D1 added `src/components/archives/archived-task-list.test.tsx` with two tests for first-seen named-phase order, within-phase order, `No phase` last, and suppression of a masked task's raw returned phase.
- D2 added `src/components/users/member-actions.test.tsx` with three tests: Deactivate is menu-based for an active non-self row, Reactivate stays direct with no menu trigger, and the self row renders only `You` with no menu. No existing test file or assertion changed in Part D.

## Preserved contracts inspected in Part D

- Archives keeps the existing event query, task query and `created_at` ordering, per-task `get_task` content reads, archived-assignee reader, error handling, links, masking, priority/status presentation, and role guard. Phase grouping uses only existing task and `get_task` output; named groups follow first appearance in those ordered rows, while null/blank rows form the final `No phase` group.
- A masked archived task is grouped under `No phase` even when its raw task row carries a phase. The grouping code recognizes the existing `get_task` masked-title sentinel, does not request an additional field, and does not render that phase.
- `src/app/(dashboard)/users/page.tsx` is unchanged, preserving the Admin-only active-profile guard, exact committee/member selects, invite dialog, and safe page-load error. `UsersTable` keeps the same search fields, visible/total count, initial data, endpoint, request payload, confirmation state, busy lock, safe errors, and local roster update.
- Deactivate renders only for the existing active, non-self row condition and now lives in a menu with the same confirmation. Inactive non-self rows keep direct Reactivate. The self row renders `You`; neither case mounts an empty menu trigger. No Remove action or new capability rule was added.

## Preserved contracts inspected in Part C

- `list_event_board_tasks`, its arguments and response validation, the fully loaded query, polling/focus behavior, and the event-page reader are unchanged.
- Confidential shells retain their existing title masking, lock treatment, assignee hiding, link target, and lack of unauthorized Move/Claim controls.
- dnd-kit sensors, sortable transforms, movement permissions, neighbor hints, optimistic state, Undo, Move controls, phone completion control, dependency restrictions, Claim writer, safe errors, and authoritative invalidation are unchanged.
- Priority filtering remains available to every role; committee filtering and its mounted controls remain Admin-only. Priority values, effective-priority calculation, ordering, and saved form values are unchanged.
- The Backlog remains an accessible Sheet with Escape dismissal and focus return to its trigger. No new action, hidden control, paging, mobile swipe/collapse behavior, reader, writer, RPC payload, permission, RLS, polling, or data shape was added.

## Preserved contracts inspected in Part B

- Workspace retains its page-level signed-in and active-role guards, parallel initial RPCs, exact reader arguments, runtime validators, filters, sorts, focus/visibility-aware 15-second polling, retries, mutations, refetches, and existing 50-row/Load more behavior.
- Task detail retains its page-level guards, UUID validation, `get_task_detail` confidential masking, work-link/edit-control/backup/workload readers, fixed polling behavior, and all existing mutation RPC names and arguments.
- Task Delete renders only from `can_delete`, comment Delete only from `out_can_delete`, and work-link Remove only from `can_remove`; no menu trigger mounts when its menu would have no authorized action.
- Task and comment deletion keep their existing confirmation, busy lock, safe error, payload, and refresh/navigation paths. Comment Edit remains separately capability-driven and aligned beside the delete-only menu.
- Work-link Remove uses the unchanged `remove_task_work_link` call and `p_link_id` payload. Its new confirmation closes only after successful removal, stays open with the existing mapped safe error after failure, blocks duplicate confirmation while pending, and performs no mutation on Cancel.
- The assignee picker receives the same existing control rows and workload map only when edit controls exist. No hidden picker, protected-row preload, reader, data shape, or assignment payload changed.

## Preserved contracts inspected in Part A

- Home retains its `requireUser()` call, active leadership lookup, RLS-scoped event query, ordering, incomplete-task count query, role conditions, event links, and archive request contract.
- Archive remains available only when the server-derived profile is Admin and its incomplete-task count loaded successfully. Moving its trigger into a menu did not change the confirmation, event id, expected incomplete count, exact `updated_at` value, busy state, safe error text, redirect, or refresh.
- Settings retains its page-level `requireUser()` call and the existing independent full-name, avatar, and password flows. The full-name RPC, validation, response checks, refresh, and error mapping are unchanged.
- Create Event and Edit Event retain their own active Admin/Co-Admin guards. Edit Event still excludes confidential title and description from its raw task query and reads them through `get_task`.
- The shared Event form retains the same fields, validation, task limits, template reader, create/edit RPC payloads, optimistic-concurrency token, banner flow, task removal rules, save/launch behavior, and navigation.
- The Create/Edit assignee picker still receives only the existing safe active-assignee workload rows. Its grouping, selection preservation, inactive-assignee handling, and payload are unchanged; no hidden picker or additional reader was introduced.

## Destructive-action matrix

| Surface          | Capability source                                                    | Placement and confirmation                                          | Contract to preserve                                                                                                                                       | Status                                    |
| ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Home Archive     | Existing server-derived Admin condition plus loaded incomplete count | Per-event menu, then existing confirmation                          | Same event id, incomplete count, exact event version, busy state, safe errors, redirect, and refresh                                                       | Part A implemented; browser check pending |
| User Deactivate  | Existing User Management active/non-self row conditions              | Per-user menu, then existing confirmation                           | Same endpoint, payload, pending lock, safe errors, and local roster update; Reactivate remains direct and self remains `You`                               | Part D2 implemented; owner gate pending   |
| Task Delete      | `can_delete` from the edit-controls reader                           | Task menu, then existing confirmation                               | Same RPC, payload, busy state, safe errors, and authoritative refresh                                                                                      | Part B implemented; browser check pending |
| Comment Delete   | `out_can_delete` from the comment reader                             | Per-comment menu, then existing confirmation; Edit remains separate | Same writer, comment id, busy state, safe errors, and thread refresh                                                                                       | Part B implemented; browser check pending |
| Work-link Remove | `can_remove` from the work-link reader                               | Per-link menu, then new simple **Remove this link?** confirmation   | Owner-approved behavior addition: Cancel performs no mutation; Remove invokes the unchanged removal call once; keep the existing busy lock and safe errors | Part B implemented; browser check pending |

The following stay direct controls: Reactivate, Leave Task, profile-photo Remove, bulk actions, and typed-confirmation actions. Removal of task/phase rows inside Create/Edit Event remains form-state UI and does not gain a new menu or confirmation.

## Manual three-account checklist

These checks require real authenticated browser sessions and are not claimed complete by the automated gate. Use **Claudee** (Admin), **Claude HAAAA** (Co-Admin), and **tv** (Member) on every page each account can access.

### Global visual and accessibility checks

- [ ] Check desktop and phone widths in both light and dark themes.
- [ ] Confirm foreground, muted text, borders, focus rings, selected states, disabled states, and destructive states remain readable in both themes and never rely on color alone.
- [ ] Keyboard through every changed control. Confirm visible focus, logical order, Escape/outside dismissal where supported, and focus return after menus and dialogs close.
- [ ] Measure phone buttons, icon triggers, menu items, tabs, picker rows, and dialog actions; each interactive target must be at least 44 by 44 CSS pixels.
- [ ] Test long event, phase, task, committee, and member names. Confirm text wraps or truncates safely and no changed page, card, menu, picker, or dialog creates horizontal page overflow.
- [ ] Confirm loading, empty, and error states remain distinct; loading geometry matches the final layout and errors never expose raw database messages.

### Part A - Home

- [ ] As Claudee, confirm each Active event has one top-right menu containing Edit and Archive, and no separate visible Edit button.
- [ ] Open Archive by pointer and keyboard. Confirm the menu item opens the existing confirmation, Cancel does nothing, and focus remains predictable.
- [ ] Confirm archive text reports the same incomplete-task count. While confirming, verify duplicate submission is blocked; success reaches Archives and refreshes, while offline/stale/permission failures show the existing safe error.
- [ ] As Claude HAAAA, confirm each Active menu contains Edit but not Archive. As tv, confirm Active cards have no `...` menu button and still open the board.
- [ ] Confirm independent Edit/menu controls are siblings of the stretched event link with no nested-interactive warning.
- [ ] Confirm Draft cards have no `...` menu. As Claudee and Claude HAAAA, confirm a visible 44px Edit action appears under the existing capability; confirm Members still receive no Draft or Edit access.
- [ ] Confirm Drafts use the compact dashed layout with a small thumbnail, dates, “Not launched,” visible Draft badge, and one-column list, while Active cards retain their larger banner layout. Confirm long names never collide with the badge or Edit at phone or desktop widths.
- [ ] For a valid Draft `updated_at`, confirm the relative “Last edited” line is server-rendered and its exact timestamp identifies Philippine time. Confirm a missing or invalid value omits the line without breaking the card.
- [ ] Confirm every Active card ends with “View board →”, the whole card remains one stretched link, and the independent menu remains a sibling. Check static hover and keyboard-focus border/shadow states in both themes.
- [ ] Confirm Active and Draft section headings each show one helper line and a readable count chip in both themes.

### Part A - shell overlap follow-up

- [ ] At desktop width, expand and collapse the sidebar repeatedly. Confirm the full round toggle stays visible and clickable above the sticky header in both states.
- [ ] Confirm the header remains below dialogs (`z-50`), does not cover the sticky event summary, and does not disturb phone navigation (`z-30`, phone-only).

### Part A - Settings

- [ ] Confirm Settings is centered in its narrower content column, never exceeds two columns, and Profile, Profile Photo, and Password remain independent equal-width cards that stack before becoming cramped.
- [ ] Profile Save starts disabled with **No unsaved changes**, becomes an obvious primary action after the name changes, disables while saving, and returns to disabled after a successful save.
- [ ] Submit invalid and failing names and confirm the existing validation and safe errors remain. Confirm a successful save refreshes the displayed identity.
- [ ] Choose, crop, upload, change, and directly remove a profile photo. Confirm the crop dialog fits the phone viewport and the existing cleanup retry behavior remains.
- [ ] Confirm Password fields fill their card width without looking narrow or left-stuck. Confirm label/id coupling, eye toggles, set/change behavior, validation, busy states, and errors are unchanged.

### Part A - Create Event and Edit Event

- [ ] As Claudee and Claude HAAAA, open both routes and confirm each page keeps its current role and active-user boundary. Confirm tv is still redirected away.
- [ ] On Create Event, switch between Scratch and Archive Template by pointer and keyboard. Confirm selected state, search, import, re-import confirmation, skipped-task summaries, and current data behavior are unchanged.
- [ ] On both routes, verify Fundamentals and Tasks tabs, banner controls, labels, dates, description count, phases, empty phases, task cards, summary checks, Save Draft/Save Changes, and Launch Event.
- [ ] Confirm Save Changes is the single primary action for an Active event; Draft save remains supporting when Launch Event is available.
- [ ] On desktop, confirm the summary remains sticky while the left form content drives page scrolling; if the summary exceeds the viewport, confirm its actions remain reachable without page overflow. On phones, confirm it stacks normally without sticky positioning or trapped scrolling.
- [ ] Confirm Create shows Launch Event clearly as the primary summary action with Save Draft supporting and Cancel quiet below; Edit keeps its status badge in the header and places Cancel below its summary save/launch actions.
- [ ] Confirm summary Cancel is an outline action. With the desktop shell header stuck in place, tab to every form field and confirm neither focused fields nor the summary are covered; the summary starts below the header and stays within the viewport.
- [ ] Open the task editor on a phone and desktop. Confirm all fields, Live Operation controls, footer actions, and the assignee picker stay inside the viewport.
- [ ] Confirm the task editor has visible compact Details, When, and Who groups, a simple non-duplicative header, one internal scroll region, and an always-reachable footer at short phone heights and with the virtual keyboard open.
- [ ] Operate the local Deliverable/Live Operation radio segments by pointer, Tab, and arrow keys. Confirm the selected state uses shape/text as well as color, every target is at least 44px, switching types preserves the existing conditional fields and handlers, and the sign-in segmented control remains unchanged.
- [ ] Submit with an empty title, missing committee, incomplete live schedule, and end time before call time. Confirm the unchanged safe error stays visible above the pinned actions and the first problem is focused and scrolled into view.
- [ ] In the assignee picker, confirm selected rows are clear without relying only on color, selected-committee members remain first, other committees remain separate, search behavior is unchanged, and inactive retained assignees reveal no profile data.
- [ ] With 0, 1, 2, and many filtered selected-committee assignee rows, confirm bulk controls appear only at 2 or more. Verify `Select all shown (n)` is a real keyboard-operable checkbox, exposes checked/unchecked/mixed states, keeps focus after repeated Space presses, and updates only those selected-committee rows without changing filtered-out selections or visible other-committee rows.
- [ ] With hidden retained selections, verify the select-all calculation counts unique hidden and filtered selected-committee ids toward 100. Confirm selection is disabled only when adding all bulk-eligible rows would exceed 100, the limit explanation is visible and exposed to assistive technology, `Clear shown` affects the same selected-committee scope, and individual selection/server validation are unchanged.
- [ ] Confirm each active row shows its existing avatar and name, the existing active-task count as the muted second line, and its existing committee as a chip; no email, role, or newly fetched profile field appears.
- [ ] Confirm changing task committee preserves selections, Co-Admin task committee options remain scoped, and no protected picker request or data appears for an unauthorized user.
- [ ] Add, edit, and remove form-state phases/tasks and confirm existing restrictions and confirmation behavior are unchanged. Save and reload to verify the same payload behavior.
- [ ] Confirm phase/task trash controls are quiet until hover or keyboard focus, existing disabled removal remains clear, task-row hover does not imply a new action, and persisted status chips contain both an icon and status text.
- [ ] Confirm substantial empty panels reuse the existing static tiger artwork without motion; no new image asset or library is present.
- [ ] Trigger validation, concurrency, banner, and network failures and confirm buttons always leave their busy state on failure and safe errors remain visible.

### Part B - Tasks workspace and task detail

- [ ] In the browser, verify tabs, keyboard tab movement, My Tasks-only filters/sorts, persisted selections across tab switches, counts, actions, compact divided rows, loading/error/empty states, polling, and current 50-row behavior.
- [ ] Verify real, masked, unavailable, and Archived task states; task assignment, dependencies, confidentiality, backup, volunteers, archive sharing, comments, links, and Leave Task retain current permissions.
- [ ] Verify task Delete, comment Delete, and work-link Remove against the destructive-action matrix, including work-link Cancel/no-op and exactly one removal on confirmation.

### Part C - Event board

- [ ] As Claudee, Claude HAAAA, and tv, check the board at desktop and phone widths in both light and dark themes. Verify the event hero with and without a banner, the tiger placeholder, compact phases/filters/lanes/cards, loading/error/empty states, and no horizontal overflow.
- [ ] Verify the progress ring at exactly 0%, 50%, and 100% in both themes: no progress dot at 0%, the correct orange arc at 50% and full arc at 100%, with the existing percentage and “N of M tasks completed” calculations unchanged.
- [ ] Verify real and masked cards, Priority filtering for all three roles, and committee-filter visibility for Admin only. On a short phone viewport, confirm both option lists scroll internally with their first options reachable; at `sm` and wider, confirm their prior heights remain. Confirm both filters dismiss and return focus predictably.
- [ ] Verify desktop pointer and keyboard drag, Member movement, leadership reorder, Move controls, phone completion control, dependency locks, Claim, Undo, polling/focus pause, safe errors, and authoritative ordering after refresh. Confirm no Batch 6 swipe/collapse behavior appears.
- [ ] Open and close Backlog by pointer, keyboard, Escape, outside interaction, and its close button. Confirm focus returns to Backlog, the drawer stays viewport-contained, Claim and masking remain capability-driven, and no decorative card-entry cascade appears.
- [ ] Check Critical, High, Medium, and Low chips in both themes on My Tasks, Help Wanted, task detail, board cards, Backlog cards, board Priority options, Create/Edit Event summaries and selectors, and archived event task cards. Confirm every chip keeps a readable text label and the event-form selector retains its value, accessible name, and keyboard behavior.

### Part D - Archives and User Management

- [ ] Verify `/archives` and `/archives/[eventId]` at desktop and phone widths in both themes: bounded 16:9 real/tiger banners, compact read-only notice, first-seen named phase order, counts, within-phase task order, `No phase` last, real/masked content, deactivated assignees, task links, and Archived read-only behavior.
- [ ] As Claudee, verify the unchanged User Management search and visible/total count, current unpaged roster, invite flow, Deactivate menu/confirmation, direct Reactivate, self-row `You`, busy state, and safe errors. Confirm no empty action trigger appears and the page remains inaccessible to Claude HAAAA and tv.

## Earlier regression documents

- Re-run the relevant manual portions of `docs/PHASE-4-STEP-6-TESTS.md`, `PHASE-4-STEP-7-TESTS.md`, `PHASE-4-STEP-7A-TESTS.md`, `PHASE-4-STEP-7B-TESTS.md`, `PHASE-4-STEP-8-TESTS.md`, `PHASE-4-STEP-9-TESTS.md`, `PHASE-4-STEP-9A-TESTS.md`, and `PHASE-4-STEP-10E-GATE.md` as their surfaces land in Parts B-D.
- Their SQL pastes are unchanged and are not rerun for this presentation-only batch.

## Part A changed files

- `docs/DESIGN-SYSTEM.md`
- `src/app/(dashboard)/home/page.tsx`
- `src/app/(dashboard)/home/loading.tsx`
- `src/components/layout/desktop-header.tsx`
- `src/components/layout/mobile-topbar.tsx`
- `src/components/layout/app-shell.tsx`
- `src/app/(dashboard)/settings/page.tsx`
- `src/components/events/event-card-menu.tsx`
- `src/components/events/event-form.tsx`
- `src/components/settings/avatar-uploader.tsx`
- `src/components/settings/full-name-form.tsx`
- `src/components/settings/settings-section.tsx`
- `src/components/shared/page-skeleton.tsx`
- `docs/phase-4b/step-3.md`
- `docs/phase-4b/step-3-tests.md`
- `docs/PROGRESS.md`

## Part C changed files

- `src/app/globals.css`
- `src/app/(dashboard)/events/[eventId]/page.tsx`
- `src/app/(dashboard)/archives/[eventId]/page.tsx` (priority badge line only)
- `src/components/events/event-board.tsx`
- `src/components/events/event-board-skeleton.tsx`
- `src/components/events/event-board-progress-ring.tsx`
- `src/components/events/event-board-progress-ring.test.tsx`
- `src/components/events/event-board-task-card.tsx`
- `src/components/events/event-form.tsx`
- `src/components/shared/priority-badge.tsx`
- `src/components/shared/priority-badge.test.tsx`
- `src/components/tasks/my-tasks-list.tsx`
- `src/components/tasks/help-wanted-list.tsx`
- `src/components/tasks/task-detail.tsx`
- `docs/DESIGN-SYSTEM.md`
- `docs/PROGRESS.md`
- `docs/phase-4b/step-3.md`
- `docs/phase-4b/step-3-tests.md`

## Part D changed files

- `src/app/(dashboard)/archives/page.tsx`
- `src/app/(dashboard)/archives/loading.tsx`
- `src/app/(dashboard)/archives/[eventId]/page.tsx`
- `src/app/(dashboard)/archives/[eventId]/loading.tsx`
- `src/components/archives/archived-task-list.tsx`
- `src/components/archives/archived-task-list.test.tsx`
- `src/app/(dashboard)/users/loading.tsx`
- `src/components/users/users-table.tsx`
- `src/components/users/members-table.tsx`
- `src/components/users/members-cards.tsx`
- `src/components/users/member-actions.tsx`
- `src/components/users/member-actions.test.tsx`
- `src/components/users/member-status-badge.tsx`
- `docs/PROGRESS.md`
- `docs/phase-4b/step-3.md`
- `docs/phase-4b/step-3-tests.md`

D1 is owner-confirmed committed. No D2 deployment, commit, push, database operation, or Supabase operation is claimed.

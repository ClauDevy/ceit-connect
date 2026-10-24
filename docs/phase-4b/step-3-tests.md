# Step 3 tests: UI redesign pages

**Branch:** `feature/ui-redesign-pages`
**Status:** Part A automated gate passed locally; Parts B-D and real-browser checks pending
**Database impact:** None. No SQL, migration, RLS, grant, reader, writer, or Supabase command is part of this batch.

## Automated gate by part

### Part A - Home, Settings, and Create/Edit Event

- `npm test` - passed: 27 files, 267 tests.
- `npm run build` - passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` - passed with zero reported errors or warnings.
- `git diff --check` - passed; Git reported only the repository's Windows LF-to-CRLF working-copy notices.
- Part A follow-up 2 reran the full gate with the same result: 27 files / 267 tests, Next.js 16.3.4 with all 23 routes, zero-warning lint, and a passing whitespace check.
- Follow-up 3 Stage 1 passes 27 files / 267 tests, the Next.js 16.3.4 production build with all 23 routes, and zero-warning lint. The Stage 1 scoped whitespace check passes. The repository-wide `git diff --check` reports only unrelated trailing whitespace at `docs/prototypes/index.html:336`; prototype files were not touched.
- `git diff --exit-code HEAD -- src/components/ui/segmented-control.tsx src/components/auth/sign-in-panel.tsx` passed with no output. The sign-in segmented control and its caller therefore retain the exact tracked markup, native keyboard behavior, and sizes; the event task-type radio segments are local to `event-form.tsx`.
- On this Windows machine the package scripts were invoked through `npm.cmd` because PowerShell blocks `npm.ps1`; the package scripts themselves are unchanged.

### Parts B-D

Pending. Add each part's exact command results only after that part is implemented and verified.

## Preserved contracts inspected in Part A

- Home retains its `requireUser()` call, active leadership lookup, RLS-scoped event query, ordering, incomplete-task count query, role conditions, event links, and archive request contract.
- Archive remains available only when the server-derived profile is Admin and its incomplete-task count loaded successfully. Moving its trigger into a menu did not change the confirmation, event id, expected incomplete count, exact `updated_at` value, busy state, safe error text, redirect, or refresh.
- Settings retains its page-level `requireUser()` call and the existing independent full-name, avatar, and password flows. The full-name RPC, validation, response checks, refresh, and error mapping are unchanged.
- Create Event and Edit Event retain their own active Admin/Co-Admin guards. Edit Event still excludes confidential title and description from its raw task query and reads them through `get_task`.
- The shared Event form retains the same fields, validation, task limits, template reader, create/edit RPC payloads, optimistic-concurrency token, banner flow, task removal rules, save/launch behavior, and navigation.
- The Create/Edit assignee picker still receives only the existing safe active-assignee workload rows. Its grouping, selection preservation, inactive-assignee handling, and payload are unchanged; no hidden picker or additional reader was introduced.

## Destructive-action matrix

| Surface | Capability source | Placement and confirmation | Contract to preserve | Status |
|---|---|---|---|---|
| Home Archive | Existing server-derived Admin condition plus loaded incomplete count | Per-event menu, then existing confirmation | Same event id, incomplete count, exact event version, busy state, safe errors, redirect, and refresh | Part A implemented; browser check pending |
| User Deactivate | Existing User Management row/self conditions | Per-user menu, then existing confirmation | Same endpoint, payload, pending lock, safe errors, and local roster update | Part D pending |
| Task Delete | `can_delete` from the edit-controls reader | Task menu, then existing confirmation | Same RPC, payload, busy state, safe errors, and authoritative refresh | Part B pending |
| Comment Delete | `out_can_delete` from the comment reader | Per-comment menu, then existing confirmation; Edit remains separate | Same writer, comment id, busy state, safe errors, and thread refresh | Part B pending |
| Work-link Remove | `can_remove` from the work-link reader | Per-link menu, then new simple **Remove this link?** confirmation | Owner-approved behavior addition: Cancel performs no mutation; Remove invokes the unchanged removal call once; keep the existing busy lock and safe errors | Part B pending |

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
- [ ] Confirm the task editor has visible Details, When, and Who groups, an icon-badge header, one internal scroll region, and an always-reachable footer at short phone heights and with the virtual keyboard open.
- [ ] Operate the local Deliverable/Live Operation radio segments by pointer, Tab, and arrow keys. Confirm the selected state uses shape/text as well as color, every target is at least 44px, switching types preserves the existing conditional fields and handlers, and the sign-in segmented control remains unchanged.
- [ ] Submit with an empty title, missing committee, incomplete live schedule, and end time before call time. Confirm the unchanged safe error stays visible above the pinned actions and the first problem is focused and scrolled into view.
- [ ] In the assignee picker, confirm selected rows are clear without relying only on color, selected-committee members remain first, other committees remain separate, search behavior is unchanged, and inactive retained assignees reveal no profile data.
- [ ] Confirm changing task committee preserves selections, Co-Admin task committee options remain scoped, and no protected picker request or data appears for an unauthorized user.
- [ ] Add, edit, and remove form-state phases/tasks and confirm existing restrictions and confirmation behavior are unchanged. Save and reload to verify the same payload behavior.
- [ ] Confirm phase/task trash controls are quiet until hover or keyboard focus, existing disabled removal remains clear, task-row hover does not imply a new action, and persisted status chips contain both an icon and status text.
- [ ] Confirm substantial empty panels reuse the existing static tiger artwork without motion; no new image asset or library is present.
- [ ] Trigger validation, concurrency, banner, and network failures and confirm buttons always leave their busy state on failure and safe errors remain visible.

### Part B - Tasks workspace and task detail

- [ ] Pending implementation. Verify tabs, keyboard tab movement, filters, sorts, counts, actions, loading/error/empty states, polling, and current 50-row behavior.
- [ ] Verify real, masked, unavailable, and Archived task states; task assignment, dependencies, confidentiality, backup, volunteers, archive sharing, comments, links, and Leave Task retain current permissions.
- [ ] Verify task Delete, comment Delete, and work-link Remove against the destructive-action matrix, including work-link Cancel/no-op and exactly one removal on confirmation.

### Part C - Event board

- [ ] Pending implementation. Verify real/masked cards, filters, phases, lanes, full-board loading, desktop pointer/keyboard drag, Member movement, leadership reorder, Undo, polling/focus pause, safe errors, and authoritative ordering after refresh.
- [ ] Confirm phone Move controls remain unchanged and no Batch 6 swipe/collapse behavior appears.

### Part D - Archives and User Management

- [ ] Pending implementation. Verify `/archives` and `/archives/[eventId]` for real/masked task content, deactivated assignee display, links, comments, and Archived read-only behavior.
- [ ] As Claudee, verify User Management search, current unpaged roster, invite flow, Deactivate menu/confirmation, direct Reactivate, self-row handling, busy state, and safe errors. Confirm the page remains inaccessible to Claude HAAAA and tv.

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

No deployment, commit, push, database operation, or Supabase operation is claimed.

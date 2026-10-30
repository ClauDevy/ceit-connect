# Step 13c: Draft event task visibility

**Status:** Implemented locally, awaiting owner Dev application and SQL verification. No Batch 13c migration or test paste is claimed as applied or run.

**Status:** Implemented locally; SQL execution pending | **Branch:** `fix/draft-task-visibility` | **Reasoning level:** High (security-critical readers, masking, and RLS boundaries)

## Goal

Let every active Admin and Co-Admin see every task and phase in a Draft event while preserving confidential masking and keeping every write committee-scoped. Expand visibility only through safe fixed-shape readers; do not expose other committees’ confidential Draft content through raw task rows or turn visibility into mutation authority.

The stable run order for this group is **13, 13c, 13d, 13b**. Batch 13c runs after `fix/task-rules` and before event deletion and phase completion.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Decisions (made by the owner): Tasks

- Draft events: all active Admins and Co-Admins see all tasks and phases; confidential masking still applies and writes stay committee-scoped.
- Invite-only events are not being built. Events remain visible under the existing event lifecycle rules.

### `docs/PHASE-4B-PLAN.md` — Batch and audit resolutions

- Batch 13c is the dedicated Draft-event-task visibility batch and is security-critical.
- All active Admins and Co-Admins read all Draft tasks.
- Confidential masking remains in force.
- Co-Admin writes remain limited to their own committee.

## Current state

- `events_select` already lets every active Admin and Co-Admin see every Draft event.
- Raw `tasks_select` lets an active Admin read all Draft task rows but lets an active Co-Admin read only tasks in their own committee. This raw boundary is important because a task row contains its real title and description.
- `task_content_access_for_user()` currently returns `real` for a Draft task only to an Admin or the Co-Admin whose committee owns the task; every other caller receives `hidden`.
- `list_event_board_tasks()` accepts Draft events for privileged callers, but its Draft branch returns only `real` rows. It does not return masked shells.
- `get_task_detail()` and `get_task()` share the central content-access decision, so changing that decision affects multiple readers and must preserve their exact masked/hidden shapes.
- Edit Event currently relies on task RLS: an Admin receives all editable tasks, while a Co-Admin receives only own-committee task rows. Returning raw other-committee rows to that form would leak confidential content and blur write scope.
- Task insert/update/delete policies and narrow writers already enforce Admin-any-committee versus Co-Admin-own-committee behavior in their approved paths. Visibility does not authorize a write.

## Scope: in / out

**In:** safe all-Draft task/phase visibility for active Admins and Co-Admins; real non-confidential content; masked other-committee confidential shells; safe Draft board/detail behavior; an Edit Event or Draft-overview read model that can represent non-editable masked/other-committee tasks; unchanged committee-scoped writes; active/profile-less denial; catalog and regression tests.

**Out:** Member access to Draft events or tasks; broader raw task SELECT; cross-committee Co-Admin writes; revealing confidential titles/descriptions; invite-only event rules; task Realtime; event deletion; completed-phase behavior; changes to Active or Archived access except regression fixes approved separately.

## Database impact

Add one new tracked security-critical migration; do not edit the historical Draft-visibility, board, detail, or archive-sharing migrations.

Replace the current central task-content helper only as narrowly as required for Drafts:

- active Admin: `real` for every Draft task;
- active Co-Admin for their own committee: `real`;
- active Co-Admin for another committee: `real` for a non-confidential task and a safely `masked` result for a confidential task; and
- Member, inactive, profile-less, or unknown user: `hidden`.

Do not broaden `tasks_select` to all Co-Admins, because raw rows contain confidential content. Use restricted fixed-shape readers that materialize only after computing `real`/`masked`/`hidden` independently of caller task RLS.

Replace `list_event_board_tasks()` so its Draft branch admits both `real` and `masked` results for active privileged callers, using the same opaque shell contract as Active tasks. Preserve its column shape unless an explicitly versioned reader change is required by the UI. Keep committee filtering presentational and Admin-only where already established; it must not become an authorization boundary.

Replace or add the minimum safe reader needed by Edit Event or a Draft overview so a Co-Admin can see every phase and task without receiving another committee’s confidential title/description or an editable payload for rows they cannot manage. Own-committee rows remain editable; other-committee rows are read-only representations. Do not fetch real content and remove it in React.

Every reader must derive the caller from `auth.uid()`, require an active profile, use a fixed empty `search_path`, expose a fixed shape, have exact `authenticated` execute grants, and return no rows to Members/inactive/profile-less callers before revealing Draft existence beyond the existing event policy.

## Page and interaction behavior

- A Draft event surface shows every persisted phase represented by at least one task.
- Non-confidential tasks show their real safe reader fields to every active Admin and Co-Admin.
- A confidential task outside a Co-Admin’s committee appears only as the established `Confidential Task` shell with nullable content fields and no mutation controls.
- Admins retain full Draft management. A Co-Admin may edit only own-committee task rows, even when all committees are visible together.
- Other-committee rows must not be serialized into an editable Event Form payload that could be accidentally resubmitted, renamed, deleted, or reassigned.
- Empty phases remain unpersisted because phases still live only on task rows.
- Polling, focus refresh, stale handling, and safe error mapping follow the existing board/detail patterns; no Realtime subscription is added.

## Guards that must remain true

- Members never see Draft tasks, including non-confidential ones, and direct reader calls return no task information.
- Inactive and profile-less callers fail closed.
- Raw `tasks_select`, `tasks_update`, and `tasks_delete` remain active-gated and are not broadened for cross-committee Draft reads.
- An active non-owning Co-Admin sees real non-confidential Draft content but only a masked shell for confidential content.
- Confidential shells contain no title, description, assignment list, access list, dependency identifier/label, comments, work links, volunteers, or mutation capabilities beyond the established safe shell fields.
- Admin write authority remains unchanged. Co-Admin inserts, updates, deletes, assignment changes, confidentiality changes, dependencies, and Batch 11 Add/Edit remain committee-scoped according to their owning writer.
- `created_by` remains provenance only. Event creation does not grant cross-committee task writes.
- Active and Archived reader behavior, archive-only sharing, and the Archived freeze remain unchanged.
- Batch 13c adds reader changes plus narrow authorization wrappers around existing writers; it does not add a general task writer or writer marker. The wrappers delegate non-Draft and missing-task behavior to the unchanged historical bodies.

## Security risks

- Broadening raw `tasks_select` would expose confidential Draft titles and descriptions before masking. Restricted readers must own the expanded view.
- Reusing an editable task payload for cross-committee rows can turn read visibility into unintended writes when Edit Event submits the full form.
- Computing masks in the browser means secrets already crossed the boundary. Mask inside the database response.
- A helper change can silently broaden Members, inactive users, comments, work links, activity history, or archive sharing because several readers share the access decision. Test every lifecycle and role.
- Treating a Draft masked shell as `real` in a capability reader can expose assignment, dependency, confidentiality, or backup controls despite safe board rendering.
- Filtering phases after task RLS can make another committee’s entire phase disappear. The safe reader must derive phases from the full event task set while masking individual rows.

## Earlier test docs to re-run or update

- `docs/PHASE-4-STEP-1A-TESTS.md` for raw Draft SELECT/UPDATE/DELETE and profile denial.
- `docs/PHASE-4-STEP-2-TESTS.md` for Draft board role matrices, reader shape, and masking.
- `docs/PHASE-4-STEP-3-TESTS.md` for Draft detail real/masked/hidden states and dependency-label masking.
- `docs/PHASE-4-STEP-7-TESTS.md` for confidential access and capability hiding.
- `docs/PHASE-4-STEP-7A-TESTS.md` and `docs/PHASE-4-STEP-8-TESTS.md` for assignment, volunteer, and writer-scope non-regression.
- `docs/PHASE-4-STEP-9-TESTS.md` for comment denial on masked/hidden content.
- Batch 11 tests for Add/Edit task committee scope and safe form prefilling.
- Batch 12 tests for Draft snapshot masking in the Activity Log.
- Batch 13 tests for picker filtering without cross-committee write expansion.
- `docs/PHASE-4-STEP-10-TESTS.md` and the post-13b Phase 4B catalog for current helper/reader definitions, grants, policies, and zero unexpected writers.

## Test deliverable

Create `docs/phase-4b/step-13c-tests.md` when the batch lands. Include an independently rollback-safe Dev SQL paste ending in the intentional `TEST RESULTS` exception plus focused response validation and a manual role checklist.

Cover Admin, owning Co-Admin, non-owning Co-Admin, Member, inactive, and profile-less callers against non-confidential and confidential Draft tasks in several committees and phases. Assert exact `real`/`masked`/`hidden` parity across the central helper, board, detail, `get_task()`, Edit Event/Draft reader, capability readers, comments, links, volunteers, and activity log. Prove raw table access is unchanged and every direct cross-committee Co-Admin writer remains denied.

Pin function signatures, shapes, ownership, volatility, security mode, fixed search paths, execute grants, absence of overloads, unchanged task policies, and no new direct task writer. Re-run Active and Archived matrices to prove the Draft-only change did not alter them.

## Manual checklist

- As an Admin, open a Draft containing several committees and confirm every phase/task appears with real content and existing management rights.
- As an owning Co-Admin, confirm own-committee tasks are real and editable, other-committee non-confidential tasks are real but read-only, and other-committee confidential tasks are masked and read-only.
- As a different Co-Admin, repeat the matrix with ownership reversed.
- As a Member, inactive officer, and profile-less caller, confirm Draft pages/readers expose no task or phase information.
- Attempt cross-committee edits through Edit Event, Batch 11 writers, assignment, confidentiality, dependency, and direct RPC/raw paths; each must fail even though the task is visible.
- Confirm Active boards/details and Archived records retain their established real/masked/hidden behavior.

## Acceptance

Every active Admin and Co-Admin can see every persisted task and phase in a Draft event through safe fixed-shape readers. Non-confidential content is real; confidential content remains real only under approved access rules and otherwise appears as a non-leaking shell. Members, inactive users, and profile-less callers receive no Draft task data. Raw task access is not broadened, and every Co-Admin write remains committee-scoped.

## Open questions for the owner

- Choose the conventional implementation branch name for Batch 13c before work begins; the stable batch ID remains 13c.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod application without owner confirmation.
- Add `docs/phase-4b/step-13c-tests.md`.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` with the final Draft `real`/`masked`/`hidden` reader boundary and unchanged write policies.
- Add the final Batch 13c objects to the post-13b authoritative Phase 4B catalog and Batch 14 allowlists.

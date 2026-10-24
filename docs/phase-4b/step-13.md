# Step 13: Task rules

**Status:** Planned | **Branch:** `fix/task-rules` | **Reasoning level:** High (security-critical migrations and tests)

## Goal

Run the mandatory read-only loophole audit, then extend the existing self-unassign behavior with leave requests, requester cancellation, leadership approval/denial, officer automatic leave/helper behavior, complete picker exclusions, and the approved spam caps without broadening raw task access or weakening masking, archive freezes, parent immutability, or writer boundaries.

## Decisions

- Admins and Co-Admins leave an eligible task automatically.
- `unassign_self(uuid)` already allows an active assignee to leave an Active, non-Completed task when `due_date` is null or `due_date > now() + interval '72 hours'`. Step 13 extends this existing writer with requests; it does not replace the immediate-leave behavior.
- At exactly 72 hours or inside the boundary, a Member creates a pending leave request. The requester may cancel their own pending request.
- An active Admin or active Co-Admin whose committee owns the task may approve or deny. Officers never create their own leave request, so no special officer-as-requester case exists.
- The leadership pending list is at the top of `/workspace`. The task page also shows request state and provides approve/deny to authorized leadership; the requester sees their cancel action there.
- An Admin or Co-Admin who validly volunteers for backup becomes an assist assignee immediately. A Member's offer remains pending for another authorized person to accept. Nobody approves their own leave request or volunteer offer.
- Every picker hides the acting user and anyone already explicitly covered: primary/assist assignees, `allowed_viewers`, and valid pending volunteers. Committee Select all selects only that committee.
- Approved caps are 10 current Draft events per creator, 20 pending leave requests per person, and 20 pending volunteer offers per person.

## Current state

- Existing `unassign_self(uuid)` already implements null-deadline and more-than-72-hours immediate leave, assignment removal, final-primary reset, caller derivation, and Active/non-Completed lifecycle checks. It has no request path.
- `task_volunteers` stores one pending offer per task/person; officers currently also create pending rows.
- Assignment/volunteer behavior uses narrow writers and established task/event locks. Child state does not grant task-content access.
- There is no leave-request table or leadership pending-request surface.

## Scope: in / out

**In:** read-only audit and stop gate; existing immediate leave regression; leave create/cancel/list/approve/deny; top-of-`/workspace` and task-page state/actions; officer automatic leave/helper; no-self-approval; picker exclusions; committee-only Select all; all three approved caps; Draft-event writer inventory; catalog/allowlist updates; SQL/application/manual tests.

**Out:** notifications; Realtime; raw task visibility expansion; Phase 5 work; dependency-v2 behavior; unrelated picker redesign; or implementation of an audit-discovered security gap before owner review.

## Stage 1 — read-only loophole audit and stop gate

Inventory every task/event writer, direct grant, RLS policy, definer/invoker function, trigger exemption, child-table writer, service-role route, and client mutation that can affect task lifecycle, assignments, access, or Draft counts. Record each path with caller derivation, authorization, lifecycle, lock order, affected columns, exact-row checks, and tests.

If the audit finds an unplanned write or access gap, stop and give the owner the evidence and recommended correction before implementation. Do not silently expand this batch.

The audit must include event creation/edit writers because the 10-Draft-events cap applies at every path that can create an event or produce/retain Draft state. Add each affected event-writer signature to the current writer inventory and the Phase 4B catalog/Step 10 allowlists.

### Writer/state matrix

> **Rebuilt, please verify:** this matrix was reconstructed from the tracked migrations and the Phase 4 writer tests because the exact earlier prose was not available in Git.

Stage 1 must complete and pin this matrix before implementation. A blank or newly discovered path is a stop condition, not permission to infer behavior.

| Writer or boundary | Current/future mutation | Required state and caller checks | Step 13 work |
|---|---|---|---|
| `create_event_with_tasks(...)` | Creates the event and initial tasks | Active Admin or Co-Admin through existing RLS; validate requested final lifecycle | Count current Draft events for the caller under the event-cap lock whenever the result is Draft; add the final signature to the writer inventory and catalog allowlists |
| Raw `events_insert` policy | Direct event insert with caller-owned `created_by` | Existing authenticated Admin/Co-Admin policy plus active-account enforcement | Prove it cannot bypass the 10-Draft cap; replace or guard it if a race-safe cap cannot be enforced through the present policy |
| `edit_event_with_tasks(...)` and any Phase 4B replacement/wrapper | Changes event metadata/status and adds, edits, or deletes tasks | Existing event ownership/role, lifecycle, optimistic timestamp, task, and lock checks | Enforce the Draft cap whenever an edit can produce or retain a Draft event; inventory the exact final overload and its task-writer effects |
| `assign_task_people(...)` | Replaces primary/assist arrays | Active authorized leadership; editable event/task; valid assignees; task/event locks | Resolve or invalidate stale leave requests and volunteer offers consistently; preserve final-primary reset behavior |
| `unassign_self(uuid)` | Removes the caller from assignment arrays | Active assigned caller; Active non-Completed task; null deadline or `due_date > now() + interval '72 hours'` for immediate leave | Extend the established writer with the request path at exactly/inside 72 hours; do not create a competing immediate-leave writer |
| Leave create/cancel/approve/deny RPCs | Create or resolve `task_leave_requests`; approval changes assignments | Member requester for create/cancel; active Admin or matching active Co-Admin for approve/deny; requester cannot approve/deny | Add narrow deny-by-default writers, the 20-pending-per-person cap, both UI surfaces, stale-state checks, and normal activity only for assignment changes |
| `claim_task(...)`, `set_task_backup_request(...)`, and `accept_task_volunteer(...)` | Changes assignment or backup state | Existing active caller, lifecycle, content-access, authority, capacity, and lock checks | Re-test state combinations; acceptance cannot approve the caller's own offer and must clean stale offers without exceeding assignment capacity |
| `volunteer_for_task(...)` / `withdraw_task_volunteer(...)` | Creates/removes a Member offer today | Existing active Member, Active task, backup requested, not already covered; task/event locks | Keep Members pending with a 20-offer cap; branch valid Admin/Co-Admin volunteers to immediate assist assignment without creating a pending row |
| Task/event triggers, raw table grants, and child writers | May block, derive, cascade, or indirectly mutate task state | Exact current grants, trigger order, lifecycle freeze, parent immutability, and affected-row checks | Prove no raw or indirect path bypasses leave, picker, volunteer, cap, masking, or completed/archive guards; update the final catalog allowlists |

For each row, record Draft/Active/Archived and To Do/In Progress/Completed behavior, Admin/Co-Admin/Member plus inactive/profile-less callers, confidential real/masked/hidden reads, source and destination locks, expected activity rows, and the exact SQL/application tests that prove the result.

## Leave-request design

- Add a deny-by-default `task_leave_requests` table with caller-derived requester identity, immutable task/requester/creation metadata, and at most one pending row per task/person.
- Authenticated clients receive no direct table write path. Narrow RPCs create, requester-cancel, list, approve, and deny.
- Every writer re-reads active caller, stored task/event, assignment, role, committee, status, deadline, and request state under the established locks.
- Creating a request is valid only for an assigned active Member on an Active, non-Completed task at or inside the 72-hour boundary. Null or later deadlines continue through immediate `unassign_self`.
- Cancellation is requester-only and affects only that pending request.
- Approval removes the requester from both assignment arrays through the existing final-primary reset behavior and resolves the request atomically. Denial changes request state only. Assignment changes produce the normal task activity entry; request-only state changes do not forge one.
- Stale requests fail safely or are resolved when assignment, task status, event lifecycle, deadline eligibility, or caller authority changes.

## Pending-request UI

- `/workspace` places the leadership-only pending section above the existing workspace tabs/content.
- The task page shows the current request state to the requester and authorized leadership.
- Authorized Admins and task-committee Co-Admins can approve/deny from both surfaces. The requester can cancel from task detail.
- Non-matching Co-Admins and Members never receive leadership rows, counts, or decision controls. No notification is created.

## Auto-helper behavior

- A valid officer volunteer action appends the caller directly to `assist_assignees`, creates no pending offer, and produces exactly one normal assignment activity entry.
- Member offers stay pending. Acceptance rejects `p_user_id = auth.uid()` before mutation.

## Picker and Select-all rules

> **Rebuilt, please verify:** this subsection was reconstructed from the tracked picker/assignment migrations and the approved owner decisions because the exact earlier prose was not available in Git.

- Every assignment, viewer, helper, volunteer, and related people picker excludes the acting user and anyone already present in `primary_assignees`, `assist_assignees`, `allowed_viewers`, or a still-valid pending volunteer offer.
- Existing selected people are rendered as chips independently of the candidate list. If a selected person later becomes inactive, retain that inactive chip so authorized editors can see and remove it; never silently drop it from the submitted state.
- Inactive people are not offered as new candidates. Removed, stale, duplicated, self, wrong-committee, or otherwise unauthorized ids are rejected again by the authoritative writer.
- `Select all` means only **Select all in this committee**. It selects the eligible candidates returned for that one committee after all exclusions; it never selects across committees, hidden result pages, stale client caches, or people outside the current authoritative result.
- Client filtering is supplemental. Server writers independently reject duplicates, self-approval, self-selection where prohibited, stale people, forged ids, already-covered people, and out-of-scope Select-all payloads.

## Approved caps and writer inventory

- **10 current Draft events per creator:** enforced race-safely by every event writer that can create or leave an event in Draft. Inventory `create_event_with_tasks(...)`, direct event insert policy behavior, `edit_event_with_tasks(...)`, and any Phase 4B replacement/wrapper discovered by the Stage 1 audit. Pin the final exact set in the current writer inventory, Phase 4B catalog, and Step 10 allowlists.
- **20 pending leave requests per person:** checked under lock when creating a request; cancellation/approval/denial release capacity.
- **20 pending volunteer offers per person:** checked under lock when a Member volunteers; withdrawal/acceptance/cancellation/stale cleanup release capacity. Officer auto-helper creates no pending offer.

Existing rows at a boundary are counted authoritatively in the database. UI counts are advisory only. Each cap has below/exactly/above and serialized-loser tests.

## Database impact

Add one tracked security-critical migration for the deny-by-default leave table, narrow functions, approved cap enforcement, and only the volunteer/assignment/event writers that require replacement. Preserve fixed empty search paths, caller derivation, exact grants, no overloads, authorization-before-sensitive errors, exact affected-row checks, and established task/event locking and retry behavior.

## Batch 15 dependency pointer

Batch 15's notification work consumes only the final, approved Step 13 outcomes and actor/recipient rules. Step 13 does not send notifications. When Batch 15 is planned, it must reference the settled leave-request transitions, officer auto-helper outcome, requester cancellation, and leadership approve/deny events without adding a second writer or broadening access to confidential task/request data.

## Guards that must remain true

- Confidential masked or hidden tasks expose no leave, volunteer, assignment, picker, or pending-request data.
- Child request/volunteer rows never grant content access.
- Archived tasks remain frozen; Draft tasks retain Batch 13c visibility rules; completed phases later gain Batch 13b's stronger freeze.
- No caller approves their own leave request or volunteer offer.
- Immediate leave at null or beyond 72 hours remains unchanged and tested.
- The 10-Draft cap is enforced by every applicable event writer, not only one UI flow.
- Every new/replaced writer appears in the authoritative inventories and allowlists.

## Security risks

- Returning pending rows before authorization can reveal confidential task existence or assignment.
- Rebuilding immediate leave in a second writer can diverge from final-primary reset and lifecycle rules; extend the existing contract instead.
- UI-only caps race. Database checks and writes must share the relevant lock.
- Missing one Draft-producing writer creates a cap bypass. The Stage 1 inventory is a gate, not optional documentation.

## Earlier test docs to re-run or update

- Re-run Phase 4 Steps 5B, 7, 7A, 8, 9A, and Step 10 tests for writers, assignments, volunteers, self-unassign, access, lifecycle, ordering, and catalogs.
- Update the final Phase 4B catalog and Step 10 allowlists with the exact leave, cap, and affected event-writer set. Historical result counts stay historical.

## Test deliverable

Create `docs/phase-4b/step-13-tests.md` when the batch lands. Include the completed audit, rollback-safe SQL, focused application tests, writer/catalog assertions, and manual evidence.

> **Rebuilt, please verify:** the detailed SQL and manual case lists below were reconstructed from the tracked migrations/tests and the approved owner decisions because the exact earlier prose was not available in Git.

The SQL cases must cover:

- `unassign_self(uuid)` with a null deadline and a deadline just beyond 72 hours remaining immediate, plus exactly 72 hours, just inside 72 hours, and already-due tasks creating the Member request path;
- request creation, duplicate rejection, requester cancellation, non-requester cancellation denial, approval, denial, repeat resolution, assignment/status/deadline/authority changes, and stale-request cleanup;
- approve/deny authorization for active Admin, matching active Co-Admin, non-matching Co-Admin, Member, inactive officer, and profile-less caller, with the same authoritative state exposed on `/workspace` and task detail;
- officer automatic leave and auto-helper, Member pending offers, withdrawal, self-accept denial, stale-offer cleanup, assignment capacity, final-primary reset, and exact activity-row behavior;
- every writer/state combination in the Stage 1 matrix across Draft/Active/Archived parents and To Do/In Progress/Completed tasks, including confidential real/masked/hidden callers and raw-table bypass attempts;
- picker exclusion of the actor, primary/assist assignees, viewers, and valid pending volunteers; retained inactive chips; forged/stale/duplicate ids; and committee-only Select all;
- 9/10/11 current Draft events per creator through every inventoried event writer, 19/20/21 pending leave requests per person, and 19/20/21 pending volunteer offers per person, including serialized concurrent attempts and capacity released by every approved resolution/cleanup path; and
- exact function signatures, owners, security mode, empty search paths, grants, policies, triggers, writer inventories, and Phase 4B catalog/Step 10 allowlists, while retaining prior Phase 4 counts as historical.

## Manual checklist

- Confirm null and more-than-72-hour Member leave still uses immediate `unassign_self`; exactly-at and inside create a request.
- As requester, cancel from task detail. As authorized leadership, approve/deny from `/workspace` and task detail.
- Confirm unauthorized roles receive no leadership list or request details.
- Confirm officer leave and volunteering are automatic while Member volunteering stays pending for someone else.
- Exercise every picker exclusion, retain and remove an inactive selected chip, and verify Select all adds eligible people only from the named committee.
- Make an offer stale by changing assignment or task state, then confirm cleanup releases offer capacity without granting task access.
- Fill assignment capacity and verify leave/helper/accept paths preserve capacity and final-primary rules without duplicate people or partial writes.
- Exercise the writer/state matrix across each applicable lifecycle/status combination and all three roles, including masked and unauthorized views.
- Exercise all three caps at 9/10/11, 19/20/21, and 19/20/21 respectively, including concurrent attempts and capacity released by cancellation, resolution, withdrawal, acceptance, and stale cleanup.

## Acceptance

The audit reaches an owner-reviewed pass before implementation. Existing immediate leave is preserved and extended with request/cancel behavior. Authorized leadership resolves requests from both approved surfaces without notifications; officers leave and become helpers automatically; nobody self-approves; pickers and Select all follow the exact rules; and all three caps are race-safe across the complete writer inventory. Masking, lifecycle, writer catalogs, and raw dependency gates remain intact.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification.
- Add `docs/phase-4b/step-13-tests.md` and update `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, the Phase 4B catalog, and Step 10 allowlists with only the final approved objects and writers.

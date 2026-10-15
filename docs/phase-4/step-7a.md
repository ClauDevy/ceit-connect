# Step 7A — Assignment, deletion, and self-unassign

**Status:** Optional.

- Add `assign_task_people(...)`, a narrow definer changing only primary/assist arrays. Active Admins and all active Co-Admins may use it across committees. Validate ids, activity/new-assignee rule, duplicates, maximums, and existing-inactive retention consistently with Phase 3.
- Add `delete_task(...)` for active Admin/all Co-Admins across committees. Delete only a stored `To Do` task; reject prerequisites and deletion leaving an Active event empty. Confirmation stays in modal; no drag-delete. Deferred tests force constraints immediate.
- Add `unassign_self(...)`, deriving `auth.uid()` and removing only that id. If final primary leaves, task returns to Backlog. Reject within 24 hours of due time or overdue; direct caller to Request Backup or leadership. Warn when confidential access will be lost. Log actor/time; notifications wait for Phase 5. Admin/all Co-Admins can always remove anyone via assignment function.
- These functions use Step 7's proven migration-owner and single assignee-guard branch by default, or its documented fallback if tests required it. Cross-committee actions are narrow exceptions; general edit remains own-committee. Creator grants no right. Do not broaden raw update/delete or add a general board endpoint.
- **Database impact:** narrow primary/assist writes; `delete_task` deletes one row. New migration: **yes**, for three functions/grants. Raw policies unchanged.
- **Guards that must remain true:** Archived parents reject writes; delete preserves dependency and Active-event invariants; self-unassign changes no one else, respects cutoff, logs once, and never changes event id.
- **Security risks:** re-read caller/activity, stored status/due/assignments/dependents/parent; validate arrays; check exact counts. Cross-committee rights remain inside named operations and the shared guard branch.
- **Test deliverable:** `docs/PHASE-4-STEP-7A-TESTS.md` follows the global contract and proves cross-committee manager assignment/deletion, prerequisite/last-task blocks, self-unassign timing/Backlog/activity/access-loss, event-id immutability, Archived denial, unchanged general scope, and the Step 7 owner/guard design.
- **Acceptance:** approved managers assign/unassign/delete without general rights; protected/last tasks cannot delete; self-unassign follows due/access rules, restores Backlog when needed, logs actor/time; creator has no effect.

[Back to Phase 4 index](../PHASE-4-PLAN.md)

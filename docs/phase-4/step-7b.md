# Step 7B — Archive-only late sharing

**Status:** Optional.

- Add `archived_task_viewers(task_id, user_id, granted_by, created_at)` with unique `(task_id, user_id)`; derive grantor from `auth.uid()`.
- Add narrow grant/revoke functions. Only active Admin or owning active Co-Admin; parent must be Archived; target exists and is active; reject duplicates/malformed ids; revoke exact row.
- Archived confidential detail/comments/work links use `tasks.allowed_viewers ∪ archived_task_viewers`. Show the combined list only to real-content viewers. Draft/Active still use only `tasks.allowed_viewers`.
- This does not weaken archive freeze: late sharing writes only the separate child table, never Archived task/event fields. Do not special-case `tasks_guard_archived_event_writes`.
- **Database impact:** adds table/indexes/RLS/functions and updates Archived content checks. New migration: **yes**. Task RLS/archive triggers unchanged.
- **Guards that must remain true:** only Archived parents accept rows; event/task stays frozen; Draft/Active unaffected; revoke is immediate.
- **Security risks:** never trust grantor, target, role, committee, parent, or task. Child access must not reveal titles; fix paths, derive grantor, validate active targets, return limited fields, check counts.
- **Test deliverable:** `docs/PHASE-4-STEP-7B-TESTS.md` follows the global contract and proves Admin/owning-Co-Admin grant/revoke, other-role denial, active targets, Archived-only scope, unioned reads, immediate revoke, and unchanged freeze trigger.
- **Acceptance:** approved managers share an Archived confidential task without changing task row; grantee gets detail/comment/link reads but no writes; revoke removes access; Draft/Active/unauthorized attempts fail; archive triggers stay unchanged.

[Back to Phase 4 index](../PHASE-4-PLAN.md)

# Step 7B — Archive-only late sharing

**Status:** Optional. Step 7B-DB is applied on Dev and all five SQL test pastes pass. Step 7B-UI is implemented locally and awaits manual Dev verification.

- Migration `20261023160000_archived_task_viewers.sql` adds deny-by-default `archived_task_viewers(task_id, user_id, granted_by, created_at)` with primary key `(task_id, user_id)`, reverse/grantor indexes, derived grantor, immutable rows, and a fail-closed task-then-event Archived-parent guard with no cascade exception.
- Narrow grant/revoke functions authorize an active Admin or owning active Co-Admin before taking locks, then lock task, lock stored parent event, and re-check relationship, authority, and Archived-confidential status. Grant requires an active target without existing real access; revoke deletes the exact row and also works after target deactivation.
- The stable, lock-free `get_archived_task_share_controls(task, search)` reader applies the same non-leaking authorization before search/lifecycle errors and returns at most 20 safe active targets.
- Archived confidential detail/comments/work links use `tasks.allowed_viewers ∪ archived_task_viewers`. Show the combined list only to real-content viewers. Draft/Active still use only `tasks.allowed_viewers`.
- This does not weaken archive freeze: late sharing writes only the separate child table, never Archived task/event fields. Do not special-case `tasks_guard_archived_event_writes`.
- **Database impact:** adds table/indexes/RLS/functions and updates Archived content checks. New migration: **yes**. Task RLS/archive triggers unchanged.
- **Guards that must remain true:** only Archived parents accept rows; event/task stays frozen; Draft/Active unaffected; revoke is immediate.
- **Security risks:** never trust grantor, target, role, committee, parent, or task. Child access must not reveal titles; fix paths, derive grantor, validate active targets, return limited fields, check counts.
- **Test deliverable:** `docs/PHASE-4-STEP-7B-TESTS.md` has five self-contained rollback-safe DEV pastes with passing result counts `20 / 26 / 19 / 22 / 17`. They prove catalogs/grants, authorization-before-lock ordering, the lock-free capped reader, parent/row integrity, role and lifecycle denials, unioned reads, immediate revoke, read-only comment/link compatibility, unchanged board/My Tasks behavior, and unchanged task/event freeze guards.
- **UI:** `/tasks/[taskId]` shows the combined Additional viewers list to every real-content viewer of an Archived confidential task. The share-control RPC—not a client role check—decides whether the debounced server search and Grant/Revoke actions appear. Mutations block duplicate submissions, confirm revoke, map `CCS01`–`CCS06` plus retryable concurrency errors to safe text, and refetch detail, sharing controls, work links, and comments. The reader probes on mount and focus and polls every 15 seconds only after its last successful response; `CCS01`/`CCS02` leave the list read-only. Draft/Active behavior is unchanged.
- **UI tests:** pure Vitest coverage validates the exact four-column reader shape, trimmed 100-character search boundary, safe error mapping, and retry/unavailable classification.
- **Local verification:** all 203 Vitest tests and the production build pass. Lint has zero errors and the same three unrelated pre-existing warnings.
- **Acceptance:** approved managers share an Archived confidential task without changing task row; grantee gets detail/comment/link reads but no writes; revoke removes access; Draft/Active/unauthorized attempts fail; archive triggers stay unchanged.

[Back to Phase 4 index](../PHASE-4-PLAN.md)

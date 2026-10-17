# Step 4 — RLS-backed work links and Phase 3 Drive preview wiring

**Status:** Required.

- Add `task_work_links`: `id`, `task_id`, display `name`, canonical/safe `url`, derived `created_by`, and `created_at`. Files remain in Google Drive; Postgres stores only link metadata.
- Wire Phase 3 `YourWorkCard` into the real task detail page at `/tasks/[taskId]` and render saved links with `DrivePreview`. Primary/assist assignees add links. The link creator, an active Admin, or an active Co-Admin may remove one only while their current `task_content_access()` decision is `real`. Archived parents block every write.
- Real-content viewers read links; masked viewers receive none. Archived details keep links readable to real viewers, including optional Step 7B viewers, without write controls.
- **Database impact:** adds `task_work_links`, foreign keys/indexes, deny-by-default RLS, narrow reader/add/remove functions, and parent-status/cap/update guards. New migration: **yes**. The reader follows current content access and returns server-computed write flags; insert derives creator/assignee rights; delete permits creator/Admin/Co-Admin only with real access; no update path.
- **Guards that must remain true:** child guard freezes Archived writes independently; task archive triggers stay unchanged; links do not affect task count/status.
- **Security risks:** never trust task, creator, URL, or assignment. Re-read task/event, derive caller, validate supported HTTPS Drive/Docs URLs and lengths, prevent duplicates, and check every result.
- **Test deliverable:** `docs/PHASE-4-STEP-4-TESTS.md` follows the global contract and covers add/remove/read rights, access changes, Archived immutability, malformed URLs, duplicate submits, and every role.
- **Acceptance:** assignees add valid links; creator/Admin/Co-Admin with real access remove; others cannot write; real viewers preview on the task detail page after refresh; masked viewers receive nothing; Archived links are readable but immutable.

[Back to Phase 4 index](../PHASE-4-PLAN.md)

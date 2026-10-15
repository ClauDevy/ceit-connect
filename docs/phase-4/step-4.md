# Step 4 — RLS-backed work links and Phase 3 Drive preview wiring

**Status:** Optional.

- Add `task_work_links`: `id`, `task_id`, display `name`, canonical/safe `url`, derived `created_by`, and `created_at`. Files remain in Google Drive; Postgres stores only link metadata.
- Wire Phase 3 `YourWorkCard` into the real task modal and render saved links with `DrivePreview`. Primary/assist assignees add links. Link creator, active Admin, or active Co-Admin may remove one. Archived parents block every write.
- Real-content viewers read links; masked viewers receive none. Archived details keep links readable to real viewers, including optional Step 7B viewers, without write controls.
- **Database impact:** adds `task_work_links`, foreign keys/indexes, RLS, and parent-status write guard. New migration: **yes**. Select follows current content access; insert derives creator/assignee rights; delete permits creator/Admin/Co-Admin; no update policy.
- **Guards that must remain true:** child guard freezes Archived writes independently; task archive triggers stay unchanged; links do not affect task count/status.
- **Security risks:** never trust task, creator, URL, or assignment. Re-read task/event, derive caller, validate supported HTTPS Drive/Docs URLs and lengths, prevent duplicates, and check every result.
- **Test deliverable:** `docs/PHASE-4-STEP-4-TESTS.md` follows the global contract and covers add/remove/read rights, access changes, Archived immutability, malformed URLs, duplicate submits, and every role.
- **Acceptance:** assignees add valid links; creator/Admin/any Co-Admin remove; others cannot write; real viewers preview after refresh; masked viewers receive nothing; Archived links are readable but immutable.

[Back to Phase 4 index](../PHASE-4-PLAN.md)

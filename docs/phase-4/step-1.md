# Step 1 — Transactional archive RPC

**Status:** Gate-critical. **Prerequisite:** urgent Step 1A hotfix.

- Replace the route's direct `events` update with one database RPC that locks the target event, verifies an active Admin caller and current `Active` state, re-counts incomplete tasks inside the transaction, compares the exact count and event version with confirmation state, and archives atomically. Incomplete tasks warn but never block; use the exact count.
- Keep the route POST-only. Runtime-validate event UUID, expected incomplete count, and expected version; use the caller's session, not service role; check the RPC error; map not-found/stale/already-archived failures clearly. A changed count requires refresh and reconfirmation.
- **Database impact:** reads/updates `events.status` and `events.updated_at`; reads `tasks.event_id/status`. New migration: **yes**, for the restricted RPC and grants/revokes. Do not broaden `events_update` or task policies.
- **Guards that must remain true:** only Active → Archived; Archived event/task rows remain immutable; no task update/delete occurs, so the Active-event invariant remains intact; confidential content is never returned.
- **Security risks:** never trust client count, status, role, or version. Lock and re-read them; preserve RLS/triggers; check every result; use no service-role bypass.
- **Test deliverable:** `docs/PHASE-4-STEP-1-TESTS.md` follows the global contract and covers exact-count warnings, stale versions/counts, concurrent double submission, all statuses/roles, and unchanged archive/task guards.
- **Acceptance:** only an active Admin archives; warning count is exact; stale confirmation fails; reconfirmation archives one Active event; incomplete tasks freeze as stored; direct Archived writes still fail.

[Back to Phase 4 index](../PHASE-4-PLAN.md)

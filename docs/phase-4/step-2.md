# Step 2 — Read-only event Kanban

**Status:** Gate-critical, visible early. **Prerequisite:** Step 1A.

- Add the Active-event board at `/events/[eventId]`, linked from Home. Match relevant `event.html` sections: header, phase tabs, `TO DO / IN PROGRESS / COMPLETED` lanes, Backlog count/drawer, priority filter, loading/empty/error states, and responsive behavior. No mutations yet.
- Add an Admin-only committee filter. Co-Admins and Members receive no cross-committee control; filtering only narrows the authorized response.
- Add one narrow fixed-shape board-list RPC for active callers. For an Active event it returns all non-confidential cards to every active user with safe committee and assignee names/avatars. On non-Draft tasks, confidential real fields go only to Admin, owning Co-Admin, primary/assist assignee, or `allowed_viewers`; everyone else gets only the id needed for the masked shell, phase/status placement, and Backlog state. Draft tasks are excluded entirely for non-leadership callers even when assigned or allowlisted: the RPC returns zero Draft rows, not confidential shells. Only an active Admin or active owning Co-Admin may receive Draft rows, with real content. Never fetch raw titles then mask in React; do not broaden hardened `tasks_select` or `users` RLS.
- The board RPC and Step 3 detail RPC must call the same shared, fixed-empty-`search_path` content-access helper, so an allowed viewer or assignee receives the same lifecycle-aware real-versus-masked decision in both responses.
- Display derived effective priority: due within 24 hours is at least High; overdue is Critical. Use one tested calculation and timestamp source.
- Refetch on window focus and short-poll only while visible; stop in hidden tabs and after unmount. No task Realtime.
- **Database impact:** reads `events`, board-safe `tasks`, and only `users.id, full_name, avatar_url`. No columns. New migration: **yes**, for board RPC/grant. Raw RLS unchanged.
- **Guards that must remain true:** Draft tasks stay hidden from Members; Archives remain read-only; RPC never writes; masked callers receive no confidential fields.
- **Security risks:** a listing definer can be a bulk leak. Fix `search_path`, revoke public execute, require active caller/visible Active event, return a fixed shape, re-read ids, and check all RPC/profile errors.
- **Test deliverable:** `docs/PHASE-4-STEP-2-TESTS.md` follows the global contract and proves Active-event visibility, Draft exclusion, non-Draft shell shape, profile minimization, Admin-only filter inputs, inactive denial, unchanged raw policies, and identical board/detail helper decisions. Include confidential and non-confidential Draft fixtures: assigned Members, allowlisted Members, and other non-leadership callers must receive zero board rows, while active Admin and owning Co-Admin receive the real Draft rows.
- **Acceptance:** all active roles see safe non-confidential Active-event cards; unauthorized non-Draft confidential cards show only “Confidential Task” in the correct lane/Backlog; non-leadership callers receive no Draft rows despite assignment or allowlisting; board and detail authorization decisions match; Admin filtering and priority boundaries work; focus/poll converges without Realtime.

[Back to Phase 4 index](../PHASE-4-PLAN.md)

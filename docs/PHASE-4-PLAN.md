# Phase 4 — Task engine, Kanban, dependencies, confidentiality UI

## Goal

Turn the Phase 3 task rows into a real Supabase-backed event board and task modal, one small branch and PR at a time, while preserving the permanent archive freeze, confidential-content boundary, and Active-event-must-have-a-task invariant.

Each step follows: own branch → implementation → its independent test document → manual test → `npm run build` → `npm run lint` → CodeRabbit → PR. Do not start the next step until the owner confirms the current one works. Design sources are the relevant searched sections of `docs/prototypes/event.html`, `docs/prototypes/tasks.html`, and `docs/prototypes/dashboard.html`; never read a prototype file in full.

**Demo path:** 1A → 1 → 2 → 3 → 5a → 5b → 6 → 7.

## Approved decisions and existing schema

- Step 1A is an **urgent standalone production-security hotfix** and is built before every other Phase 4 step. Step 1 follows it.
- `tasks.status` already stores `To Do | In Progress | Completed`, and `tasks.depends_on_task_id` already stores the one direct dependency Phase 4 needs. Blocked state remains derived. A dependency gates only forward moves, never auto-reverts a dependent, and a prerequisite with dependents cannot be deleted.
- Step 5a adds `tasks.sort_order bigint`; Step 5b adds the only RPC that may persist board ordering.
- On Active events, every active user sees all non-confidential tasks through the restricted board RPC. Draft tasks remain hidden from Members. An unauthorized confidential viewer receives only an opaque **“Confidential Task”** shell in its real lane or Backlog.
- `tasks.created_by` is provenance only and never grants a right.
- General editing remains in `edit_event_with_tasks`: Admins may edit every committee; Co-Admins remain own-committee. Cross-committee exceptions use narrow functions that change one named concern.
- Default privileged-function design: narrow `SECURITY DEFINER` functions are owned by the existing migration owner role, use a fixed empty `search_path`, derive the caller from `auth.uid()`, explicitly verify role and `users.is_active`, and receive only one narrow `current_user`-based exemption in the assignee guard for the approved column set. Dedicated `NOLOGIN` executor roles are a fallback only if this simpler design cannot pass the full direct-SQL, function-body, guard, and privilege tests.
- Hosted Supabase does not grant true superuser access, but the managed `postgres` role used to apply migrations can create/alter `BYPASSRLS` roles. Phase 4 does not require `BYPASSRLS` in the default design.
- Standard Supabase CLI migration files are transaction-wrapped unless deliberately marked `-- pg-delta: transaction=false`; Phase 4 migrations must not opt out. Step 5a additionally keeps its trigger-disable/backfill/re-enable critical section in one atomic `DO` statement so the triggers are restored by statement rollback even if a nonstandard runner does not wrap the whole file.

## Security and test reminders

- RLS and database guards are the real enforcement. UI role checks are only UX.
- Pages call `requireUser()`; privileged pages/routes also use `getActiveProfileForRoles(...)`. RPCs re-read the caller and require an active profile.
- Confidential title/description comes from restricted RPCs, never an unrestricted raw task query. Never fetch secrets and remove them in React.
- Never trust client roles, ids, creator fields, assignee/viewer lists, source status, ordering, or counts. Derive or re-read them server-side.
- Every Supabase result checks `error`; request bodies are runtime-validated; client mutations use `try/catch/finally` and reconcile optimistic state on failure.
- No Phase 4 change may make an Archived event, task, or guarded child row writable. The Active-event task invariant remains enforced.
- Every task/task-child lifecycle guard trigger takes `SELECT ... FOR SHARE` on the stored parent event and then re-reads its status. The archive RPC holds the conflicting exclusive event-row lock while it recounts and archives, and it never waits on task or task-child row locks. Raw task `UPDATE`/`DELETE` necessarily locks its task row before a `BEFORE ROW` guard runs, so no universal event-first order is claimed; after waiting on archive, the guard sees `Archived` and fails. A narrow task-row RPC with a known stored parent may take the event lock before task rows as an optimization; task-child mutators use the child-specific order below. This serializes archive against raw writes, moves, claims, assignment/deletion/self-unassign, dependency/confidentiality changes, work links, and comments without removing the raw paths required by Edit Event and existing RLS. Current RLS and the foreign key do **not** make `tasks.event_id` immutable: leadership can reparent until Step 5a adds an unconditional rejection trigger. Until then, its guard locks the distinct old and destination events together in deterministic id order and validates both after locking. A task-child foreign key likewise proves only that `task_id` exists; every Phase 4 child table must make `task_id` immutable through no update path or an explicit column guard. For every child insert/update/delete—and especially any path that can change `task_id`—the guard first locks all distinct referenced task rows in deterministic task-id order, then reads their stored `event_id` values, locks all distinct parent event rows in deterministic event-id order, and re-validates the task relationships and event statuses before allowing the write.
- Every step ships its own independently paste-and-run `docs/PHASE-4-STEP-<ID>-TESTS.md`. SQL blocks impersonate Admin, owning-committee Co-Admin, other-committee Co-Admin, assigned Member, unassigned Member, allowed viewer, and inactive user; every block, including expected failures, ends in `ROLLBACK`. Deferred-trigger tests run `set constraints all immediate` before assertion. Step 1A also covers a profile-less authenticated UUID and begins with the exact pre-fix leak reproduction. Manual checks supplement rather than replace role-impersonated SQL.

## Ordered steps

1. **[Step 1A — Raw tasks read hardening](phase-4/step-1a.md) — Gate-critical, urgent hotfix.** Ship independently before all other Phase 4 work.
2. **[Step 1 — Transactional archive RPC](phase-4/step-1.md) — Gate-critical.** Complete the archive work deferred from Phase 3.
3. **[Step 2 — Read-only event Kanban](phase-4/step-2.md) — Gate-critical, visible early.** Requires Step 1A.
4. **[Step 3 — Read-only task detail page and confidential/dependency states](phase-4/step-3.md) — Gate-critical.**
5. **[Step 4 — Work links and Drive preview wiring](phase-4/step-4.md) — Required.**
6. **[Step 5a — Columns, safe backfill, and dependency integrity](phase-4/step-5a.md) — Gate-critical.**
7. **[Step 5b — Transactional task-move RPC](phase-4/step-5b.md) — Gate-critical.**
8. **[Step 6 — Drag-and-drop and mobile status controls](phase-4/step-6.md) — Gate-critical.**
9. **[Step 7 — Dependencies and confidentiality controls](phase-4/step-7.md) — Gate-critical.**
10. **[Step 7A — Assignment, deletion, and self-unassign](phase-4/step-7a.md) — Optional.**
11. **[Step 7B — Archive-only late sharing](phase-4/step-7b.md) — Optional.**
12. **[Step 8 — Claiming, backup, volunteers, and workload](phase-4/step-8.md) — Optional.**
13. **[Step 9 — Task comments](phase-4/step-9.md) — Optional.**
14. **[Step 9A — My Tasks personal feed](phase-4/step-9a.md) — Optional.**
15. **[Step 10 — Phase 4 hardening and gate](phase-4/step-10.md) — Gate-critical.**

## Deferred

- **Add task from the board (former Step 7C):** deferred beyond Phase 4. For now, the Backlog/lane **Add task** affordance links authorized Admins and Co-Admins to Edit Event; Members receive no create control. A future plan must revisit safe single-task creation and total-event capacity enforcement.
- Notifications and unread behavior are Phase 5.
- Executive Dashboard data wiring is Phase 5; its prototype is visual reference only in Phase 4.
- Supabase Realtime for tasks is not part of Phase 4; use focus refetch and short polling.

## Known limitations

- Raw `tasks` rows are not field-masked at the column level. After Step 1A, a confidential raw row is available only to an active Admin, active owning Co-Admin, or active non-Draft primary/assist assignee. `allowed_viewers` and optional archive late-share viewers use restricted content RPCs. Table-level `SELECT` remains because removing title/description grants would break the invoker-security archive-template import; permanent direct-`SELECT` regression tests guard the residual risk.
- Only one direct dependency is supported. Blocked state and effective priority are derived. Dependents are not auto-reverted when a prerequisite moves backward.
- `create_event_with_tasks` caps a new event's initial input at 200 tasks, while `edit_event_with_tasks` limits each submitted add/update/delete list to 200 but does not enforce a 200-row total for an existing event. Phase 4 adds no total-cap trigger because board task creation is deferred.
- Comment edit history is not versioned; only the current body and `edited_at` are retained.
- Phase 4 stores mention, Heads Up, assignment, and unlock intent but sends no notifications.
- Task boards and Workspace use focus refetch/short polling rather than Realtime.
- `tasks.created_by` is provenance only; historical backfill values are event-creator fallbacks, not proof of the original task author.
- Optional work links, assignment/assistance polish, comments, archive late-sharing, and My Tasks are not required for the minimum Phase 4 gate unless promoted before implementation.

## Unrelated findings

- `package.json` still contains the deferred unused packages `cn` and `p`.
- Production `ALLOWED_EMAIL_DOMAINS`, the mistyped fake-email Prod account, and parked `discord_id` Settings work remain outside Phase 4.

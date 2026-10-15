# Step 3 — Read-only task modal and confidential/dependency states

**Status:** Gate-critical.

- Open a board card in the relevant `tasks.html` modal layout: status/priority/type, event/committee, description, assignees, deadline/times, dependency/blocked banner, confidential banner, and safe loading/errors. Mutation controls remain disabled.
- Build on Step 1A: raw confidential rows are limited to active Admin, owning Co-Admin, or non-Draft primary/assist assignee. `allowed_viewers` and optional archive late-share grantees use only the detail RPC. Board visibility never implies raw table visibility.
- Add a restricted task-detail RPC, smaller board response, and shared fixed-search-path content-access helper if needed. A masked caller gets only `id`, “Confidential Task,” and board placement; a real viewer gets the authorized detail shape.
- Derive `blocked = depends_on_task_id is not null AND dependency.status != 'Completed'`. Resolve dependency labels through the same confidentiality rule. Blocking gates only forward moves and never auto-reverts.
- Draft/Active real content is visible to Admin, owning Co-Admin, primary/assist assignees, and `tasks.allowed_viewers`. Archived confidential tasks retain current paths; optional Step 7B adds archive-only viewers.
- Show the access list only to real-content viewers. Comments/work links re-check current access so revocation applies immediately; masked callers get no child rows.
- **Database impact:** reads `events`, `tasks`, and safe `users` fields. No columns. New migration: **yes**, for detail/assignee RPC and shared helper if needed. Do not broaden raw task/user RLS; preserve or strictly replace `get_task()` authorization.
- **Guards that must remain true:** Draft tasks unavailable to Members; Archived tasks frozen; modal is read-only; board/modal masks match.
- **Security risks:** never fetch full rows then hide fields. Do not expose email, role, Discord id, allowlist UUIDs, hidden dependency names, comments, work links, or inactive details through joins. Avoid divergent access helpers.
- **Test deliverable:** `docs/PHASE-4-STEP-3-TESTS.md` follows the global contract and proves real/masked shapes, immediate revocation, dependency masking, Draft/Archived behavior, and every role.
- **Acceptance:** authorized viewers get real content/access list; unauthorized Members get only the shell; revocation immediately removes task/comment/link access; blocked prerequisite names appear only when authorized.

[Back to Phase 4 index](../PHASE-4-PLAN.md)

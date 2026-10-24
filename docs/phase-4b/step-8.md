# Step 8: Officer invitations and transitions

**Status:** Planned | **Branch:** `feature/officer-invites` | **Reasoning level:** High (security-critical migrations and tests)

## Goal

Add narrow Admin-only officer invitations and transitions while preserving one account per person and protecting every Admin boundary. Admin is the SC President title; Vice Presidents are Co-Admins, and each committee's single Co-Admin is its VP when caps are enabled. Admin profiles keep `committee_id = null`. The existing `President` row remains in `committees`, but an Admin is not assigned to it by this role model.

## Decisions

### Exact officer operations

Only active Admins may initiate operations 1–5 through the officer RPCs. Operation 6 is initiated only by the affected active Admin:

1. **Invite new officer** — invite a brand-new person directly as Admin or as Co-Admin with a committee.
2. **Appoint existing active Member** — appoint an active Member as Co-Admin of a committee seat or as Admin. A Co-Admin must first be returned to Member before later appointment as Admin. This is the only way an existing account becomes an officer.
3. **Return Co-Admin to Member** — return a Co-Admin to Member in a selected committee; there is no generic role-change operation.
4. **Move Member to another committee** — move an existing Member only; no officer is moved through this operation.
5. **Cancel unaccepted officer invite** — cancel a pending Admin or Co-Admin invitation that has not been accepted.
6. **Admin step-down** — the active Admin steps down on their own initiative, becomes a Member, and chooses a committee. Another active Admin must already exist.

There are no self-service or Co-Admin officer changes. No Admin may demote, deactivate, remove, delete, or anonymize another Admin. The last active Admin can never step down, be deactivated, or be removed.

Year-end handover is either: return the old Co-Admin head to Member and appoint the new active Member; or deactivate the old Co-Admin and invite a new person. One account per person is retained so history stays attached.

### Cap setting

- Add a new `public.app_settings` singleton table with `enforce_officer_role_caps boolean not null default false`.
- RLS is enabled. `anon` and `authenticated` receive no table grants and no policy that exposes the row. The value is read only inside the officer functions.
- The exact switch is `public.app_settings.enforce_officer_role_caps`. It is `false` in Dev and Prod during Phase 4B testing.
- When false, any number of Admins and Co-Admins may exist for testing. All authorization, transition validation, and never-zero protection still apply.
- When true, there may be at most two active Admins and at most one active Co-Admin per committee, counting unaccepted officer invitations that reserve those seats.
- Invite, appointment, activation, return-to-Member, invite cancellation, and step-down paths all take the same transaction-level advisory lock. Upper-cap checks apply only to operations that add or activate an officer seat; reducing operations remain available.
- Enabling the switch never invalidates, deactivates, or rewrites existing accounts that already exceed a cap. It blocks only a new invite, appointment, or activation that would add to an already-full seat.
- Batch 14 enables the switch through a new tracked migration before final release, after test accounts are reconciled.

## Current state and mandatory preflight

- The current invite route accepts all three roles and uses service role; Batch 0 first adds its active-Admin guard.
- Admin profiles are documented with `committee_id = null`; no officer invitation/reservation model or locked transition RPC exists yet.
- Direct Admin `users` updates could bypass officer invariants and must be closed when the narrow RPCs land.
- The `President` committee lookup row remains valid data and is not removed or renamed.

Before designing the transition migration, the owner runs this read-only query separately on Dev and Prod and records only the result rows, never secrets:

```sql
select id, email, full_name, committee_id
from public.users
where role = 'Admin'
  and committee_id is not null
order by id;
```

Expected result: zero rows. If either environment returns a row, stop before writing the migration. The owner must decide whether that account's `committee_id` is corrected to null through a tracked migration or whether the role model is reconsidered. Do not silently normalize live data and do not make the officer RPCs guess.

## Scope: in / out

**In:** separate Admin-only officer invite UI and server route; pending seat reservations and cancellation; the six exact operations above; congratulations-email metadata; per-person results for 1–10 sequential invitations; shared advisory locking; `app_settings`; caps-off/caps-on behavior; last-Admin protection; raw-write closure; active-role guards; migration/catalog/concurrency tests.

**Out:** generic change-role; direct Co-Admin officer authority; Admin-to-Admin demotion/deactivation/removal; automatic account replacement; hard-deleting users; public signup; Co-Admin Member management owned by Batch 9; or remote Supabase commands by Codex.

## Database impact

Add a new tracked migration containing `public.app_settings`, a deny-by-default pending officer-invite/reservation boundary, narrow officer RPCs, and policy/trigger changes that make those RPCs the only officer-transition path. Do not edit applied migrations.

Every officer function must:

1. derive and re-verify the active caller and exact permitted operation;
2. take the same transaction-level advisory lock before reading settings, reservations, active-role counts, or targets;
3. read `public.app_settings.enforce_officer_role_caps` internally;
4. lock affected rows in deterministic UUID order;
5. re-read target roles, committees, active states, and invite states;
6. enforce never-zero protection unconditionally and upper caps only when the setting is true and the operation adds/activates a seat;
7. validate exact affected-row counts and complete the database transition atomically.

The server route uses service role only for Auth invitation/cancellation work that RLS cannot perform and only after caller-scoped active-Admin verification. Auth email and Postgres cannot share a transaction, so invitations are sequential and return honest per-person outcomes. Never delete an established account during cleanup.

### Invite sending, retry, cleanup, and partial failure

> **Rebuilt, please verify:** this operational sequence was reconstructed from `docs/GOTCHAS.md`, the current invite route, and the approved owner decisions because the exact earlier prose was not available in Git.

- Custom SMTP is limited to about 30 emails per hour. Resend is limited to 100 emails per day. The 100/day Resend value is **rebuilt, please verify** because `docs/GOTCHAS.md` names Resend but currently records only the custom-SMTP 30/hour number.
- Officer invitation batches remain 1–10 people and must stay below the approximately 30/hour custom-SMTP ceiling after accounting for other authentication email traffic. Do not fill unused batch slots merely because the UI permits ten.
- Validate the whole request and each normalized email, role, committee, existing-account result, caller authority, reservation eligibility, and caps state before sending that person's email. Reject a batch larger than ten without sending any email.
- Send invitations sequentially, never in an uncontrolled parallel burst and never with an automatic retry loop. Record a per-person result before moving to the next address.
- A safe retry resubmits only explicitly failed or cleanup-pending people after re-reading Auth, profile, pending-invite, reservation, and cap state. It must not send a second email for a person whose invitation already succeeded or create a duplicate reservation.
- If Auth invitation succeeds but the database reservation/profile finalization fails, report a partial failure and attempt only the approved cleanup for the newly created, still-unaccepted invitation. Never delete or rewrite an established account. If cleanup fails, retain an explicit cleanup-pending result for manual/retry handling.
- If the database reservation succeeds but email/Auth fails, release only that attempt's reservation under the shared officer lock, report failure, and leave capacity reusable. Cancellation and cleanup are idempotent and cannot release another invitation's seat.
- Stop or defer further sends when the provider reports a rate limit. Preserve completed per-person outcomes, leave unsent entries clearly unsent/retryable, and do not create a retry storm or claim all-or-nothing success.

## One-Co-Admin assumption inventory

Current executable authorization generally checks `role = 'Co-Admin'` plus matching `committee_id`; it works when several test Co-Admins share a committee and does not itself enforce uniqueness. The cap setting supplies the future uniqueness invariant.

Audit and retain this distinction in:

- `docs/PHASE-4B-PLAN.md`, `docs/ARCHITECTURE.md`, and this file, which describe the intended one-VP seat when caps are enabled;
- `docs/DATABASE.md` and legacy migration comments that use singular “owning” or “committee head” terminology but authorize by committee match;
- `src/components/users/role-meta.ts`, which labels a Co-Admin as heading a committee;
- `src/components/tasks/task-detail.tsx`, which uses singular explanatory copy for confidential access;
- task RLS/helpers/RPCs, whose committee-match semantics must continue to work with multiple test Co-Admins while the switch is off and with the single VP once it is on;
- Batch 13's pending-leave reader/approval UI, which is visible to every active matching Co-Admin while caps are off and to the single VP when enabled.

No current code path may depend on selecting an arbitrary first Co-Admin row.

## Guards that must remain true

- Admin `committee_id` remains null under the approved role model; the `President` committee row remains in the lookup table.
- Only active Admins perform operations 1–5. Only the affected active Admin initiates operation 6.
- A Co-Admin cannot appoint, return, move, invite, cancel, or change any officer.
- An Admin cannot change another Admin's role or active state and cannot remove/anonymize another Admin.
- The last active Admin protection is always on, regardless of the cap setting.
- Pending invites reserve seats only when caps are on and are released exactly once by cancellation, expiry handling if later approved, or successful activation.
- An account over the future limit remains usable after caps turn on; only additive invites, appointments, and activations are rejected.
- Runtime-validate every batch item and reject more than 10 before sending email. Check every Supabase result.

## Security and concurrency risks

- UI counts cannot enforce caps. All setting/count/reservation decisions occur under the shared database lock.
- Different lock keys or target-first locking can race or deadlock. Every officer writer follows the same advisory-lock-first order.
- A disabled upper cap must not accidentally disable last-Admin protection or Admin-to-Admin prohibitions.
- Enabling caps must not make existing over-limit accounts impossible to return to Member, deactivate where authorized, cancel, or step down.
- Service-role routes bypass RLS and therefore re-verify the caller before constructing or using the service-role client.
- Creating Auth invitations before durable reservation/finalization can consume SMTP/Resend budget and leave a partial account. Validate first, send sequentially, clean up only a newly created unaccepted attempt, and expose the exact partial result.
- An automatic retry can duplicate mail, reservations, or accounts. Retry is explicit, idempotent, per person, and based on authoritative Auth/database state.

## Earlier test docs and service-role callsites to re-run or audit

> **Rebuilt, please verify:** this restored inventory was reconstructed from the captured earlier-test list and current tracked callsites; the future officer-route pathname remains provisional as marked below.

- Re-run the users-policy assertions in `docs/PHASE-4-STEP-2-TESTS.md`, `docs/PHASE-4-STEP-3-TESTS.md`, and `docs/PHASE-4-STEP-4-TESTS.md` after replacing raw role/committee/active-state changes with officer RPCs.
- Re-run inactive and profile-less denials from `docs/PHASE-4-STEP-1A-TESTS.md` and the relevant Step 10 gate sessions if a shared authorization helper changes.
- Re-run/update Batch 0 tests for the Users page, current `/api/invite` route, and active-Admin invitation guard. Re-run the Phase 4 catalog tests, preserve their exact results as historical, and extend the Phase 4B catalog/Step 10 allowlists for every new table, function, trigger, policy, and grant.
- Audit every current service-role callsite: `src/app/api/invite/route.ts`, `toggle-user-active/route.ts`, `update-avatar/route.ts`, `set-password/route.ts`, `complete-reset/route.ts`, and `event-banner/route.ts`; the planned `src/app/api/invite-officers/route.ts` is **rebuilt, please verify** because its exact future pathname was not previously pinned; plus the later Batch 10 removal route. Confirm each constructs the service-role client only after its own caller/session/role/`is_active` validation. Account for the Step 7 callback path removal when that batch lands.
- The Step 8 callsite audit must list the final new officer invite route by its actual pathname before implementation is accepted; if it differs from the reconstructed path above, update this inventory and its route tests rather than adding a second route.

## Test deliverable

Create `docs/phase-4b/step-8-tests.md` when the batch lands. Include rollback-safe Dev SQL, route/UI tests, the Admin `committee_id` preflight result, catalog/grant assertions, and genuine overlapping-transaction tests.

With caps **off**, exercise all six operations: invite a new Admin/Co-Admin, appoint an active Member, return a Co-Admin to Member, move a Member to another committee, cancel an unaccepted officer invite, and Admin self-step-down. Prove a third Admin, a second same-committee Co-Admin, and additional pending reservations are permitted while operation-specific authorization, transition validation, Admin-to-Admin prohibitions, and zero-Admin protection remain enforced.

With caps **on**, exercise the same six operations. Prove the two-Admin and one-Co-Admin limits count pending invites; invite, appointment, and activation reject additions beyond the limit; return-to-Member and cancellation release the correct seat; moving a Member does not consume an officer seat; self-step-down preserves at least one active Admin; existing over-limit active accounts remain unchanged and usable; and only further additive invitations, appointments, and activations are blocked.

Cover all six operations, no generic transition RPC, active/inactive/profile-less callers, raw-write denial, Admin-to-Admin prohibitions, committee validation, unaccepted invite cancellation, one-account history, batches of 0/1/10/11, partial email failure, and service-role guard order.

Concurrency cases include competing invites, appointments, and activations for the same final seat; two step-down attempts; return-to-Member versus appointment; Member move versus appointment; cancellation versus activation; and same/different-committee operations. Run the applicable cases with caps off and caps on. Assert no zero-Admin state, partial transition, duplicate reservation, wrong committee, double-released seat, or deadlock.

Email-route cases cover 0/1/10/11 entries, normalized duplicates, other auth-email traffic near the approximately 30/hour SMTP limit, the 100/day Resend limit (**rebuilt, please verify**), provider rate-limit responses, failure before send, Auth-success/database-failure, database-reservation/Auth-failure, cleanup success/failure, explicit retry, and a later retry after the original invitation has already succeeded. Assert sequential sending and honest sent/failed/unsent/cleanup-pending results.

## Manual checklist

- Run the read-only Admin `committee_id` check on Dev and Prod and resolve any nonzero result before migration work.
- Exercise all six operations as an active Admin, including both handover paths and Admin self-step-down.
- Attempt every operation as Co-Admin, Member, inactive Admin, and profile-less user; all fail without leaking invite/target state.
- Test caps off with extra test officers, then caps on at each boundary, including existing over-limit accounts.
- Verify the `President` lookup row remains and every Admin profile created or appointed has `committee_id = null`.
- Verify rate-limit and partial failures never leave buttons stuck or cause retry storms.
- In both cap modes, explicitly repeat move Member and cancel unaccepted invite alongside the other four operations; confirm cancellation releases only its reservation and Member moves never consume an officer seat.
- Send a small sequential officer batch, simulate a mid-batch failure and cleanup failure, then retry only the failed/cleanup-pending entries. Confirm successful recipients receive no duplicate email and unsent entries are clearly reported.

## Acceptance

The six exact officer operations are the only supported transitions. Officer routes and RPCs are active-Admin guarded, raw bypasses are closed, Admin profiles keep a null committee, the lookup row remains, one-account history is preserved, and no Admin can alter another Admin. The private `app_settings` switch is off for testing, never-zero protection is always on, both cap modes and concurrency are proven, and Batch 14 tracks enabling caps before final release.

## Open questions for the owner

- Only the preflight exception is unresolved: if an existing Admin has a non-null `committee_id`, the owner must choose the tracked correction before Step 8 implementation. With a zero-row result, no decision is needed.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification.
- Add `docs/phase-4b/step-8-tests.md` and update `docs/DATABASE.md`, `docs/GOTCHAS.md`, and the Phase 4B catalog for final objects, lock order, settings, Auth orchestration, and test evidence.

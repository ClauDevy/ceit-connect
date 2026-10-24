# Step 9: Co-Admin user management

**Status:** Planned | **Branch:** `feature/coadmin-user-management` | **Reasoning level:** High (security-critical migrations and tests)

## Goal

Give an active Co-Admin a tightly scoped User Management view for their own committee. They may view own-committee Members, invite Members into that committee, deactivate or reactivate those Members, and edit `full_name` only. They may not perform officer operations, touch Admins or Co-Admins, move anyone between committees, delete or anonymize anyone, or manage another committee.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Decisions (made by the owner): Roles and invites

- Co-Admins get User Management for their own committee: view members, invite Members into it, deactivate and reactivate them, and edit basic details.
- They cannot perform officer operations, touch Admins or Co-Admins, move people between committees, or delete anyone.

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 9 is `feature/coadmin-user-management` and runs after Batch 8.

### `docs/PHASE-4B-PLAN.md` — Audit resolutions

- Batch 9 is security-critical.
- Batch 0 first removes direct Co-Admin UPDATE access on `users`; the later management feature must not restore that broad policy.

### Owner clarifications for Step 9

- The allowed Co-Admin actions are exactly: view own-committee Members; invite Members into that committee; deactivate Members; reactivate Members; and edit `full_name` only.
- Co-Admins cannot perform any of Step 8's six officer operations.

## Current state

- Current `users` SELECT RLS lets a Co-Admin see every profile in their committee, including another Co-Admin, rather than a Member-only management projection.
- The tracked `co_admin_update_own_committee_members` policy still permits direct updates within the committee with only `role <> 'Admin'` as its role guard. It can change security-relevant columns and can affect a Co-Admin. Batch 0 is explicitly responsible for removing this direct Co-Admin UPDATE policy while preserving safe own-profile editing.
- `/users` is currently Admin-only, loads all profiles, and uses an Admin-only invite dialog and activation route. Batch 0 must first convert its page and invite guard to the active-profile helper.
- `/api/invite` currently accepts a client-supplied role and committee and uses service role. Batch 9 cannot expose that contract to Co-Admins; a Co-Admin Member invite must derive `role = 'Member'` and the caller’s committee server-side.
- `/api/toggle-user-active` is currently active-Admin-only and uses service role to update the profile and remove an avatar on deactivation.
- Batch 7 owns Active/Deactivated tabs, whole-tab server search, and fetch-21/show-20 Users paging. Batch 9 must extend that safe paging pattern to Co-Admin scope rather than create a second unpaged list.

## Scope: in / out

**In:** Co-Admin access to `/users`; Member-only rows from the caller’s current committee; Active/Deactivated tabs and Batch 7 paging/search within that scope; Member invite with server-derived role and committee; Member deactivate/reactivate; `full_name` editing only; matching desktop/mobile actions and failures; Admin regression behavior; SQL and route tests for every caller/target/committee combination.

**Out:** viewing or managing Admins/Co-Admins through the Co-Admin management surface; every Step 8 officer operation; email editing; avatar editing; password state; Discord ID; deletion or anonymization; member removal (Batch 10); any direct Co-Admin UPDATE policy on `users`.

## Database impact

Batch 9 depends on Batch 0 having removed direct Co-Admin `users` UPDATE. Add a new tracked security-critical migration with narrow RPCs or an equivalently narrow database boundary for Co-Admin Member updates. Do not recreate a general policy.

The database boundary must derive the caller from `auth.uid()`, require an active Co-Admin, derive their current committee, require the target to be a Member in that same committee, reject `anonymized_at is not null` once Batch 10 exists, and update exactly one approved field/state. A full-name writer accepts only a bounded normalized string and writes only `full_name`. Activation writers write only `is_active` and must not accept role or committee parameters.

Member invitation necessarily uses a server-only Auth Admin call. The route must first verify an active Co-Admin with a non-null committee, ignore/reject client role and committee authority, invite the normalized email, and finalize only a `Member` profile in the caller’s committee. The database insert/finalization path must re-check the caller and committee rather than trusting the earlier route read.

If the Batch 7 user reader cannot safely serve both Admin and Co-Admin scopes, replace it with one fixed-shape reader that derives caller scope and returns only fields required by User Management. Preserve 21-row lookahead and whole-tab search without exposing out-of-committee match counts.

## Guards that must remain true

- Allowed Co-Admin actions are exactly: view own-committee Members, invite Members into that committee, deactivate Members, reactivate Members, and edit `full_name` only.
- A Co-Admin cannot see a management row for an Admin or Co-Admin, including one sharing their committee.
- A Co-Admin cannot target a Member from another committee even with a guessed UUID, stale browser data, or a direct request.
- Role and committee are server-derived for Co-Admin invites. Client-supplied values cannot widen authority.
- Every Step 8 officer operation remains outside Co-Admin authority.
- Batch 0’s removal of direct Co-Admin UPDATE remains in place. UI hiding is not the security boundary.
- Inactive and profile-less callers receive no rows and cannot call any writer or service-role route.
- An anonymized account can never be reactivated; Batch 10’s marker must be honored by the shared activation boundary.
- Check every Supabase call and use try/catch/finally for client requests.

## Security risks

- Restoring a broad same-committee UPDATE policy recreates the original privilege-escalation bug. Narrow column-specific RPCs are required.
- Filtering all profiles in the browser leaks Admins, Co-Admins, or other committees even if their cards are hidden. Scope must be enforced before rows leave the database.
- Accepting `role`, `committeeId`, or target role from the client lets a Co-Admin invite officers or move users. Derive and re-check authoritative values server-side.
- A target's role, committee, active state, or anonymization state can become stale between page load and mutation. Every writer must lock/re-read the target and validate current state.
- Service-role invitation and avatar cleanup bypass RLS. Routes must re-verify caller role, active state, own committee, target role, and target committee before each privileged action.
- Search result counts and lookahead rows can leak out-of-scope users. Query only the permitted Member scope.

## Earlier test docs to re-run or update

- Re-run Batch 0’s users-policy tests proving direct Co-Admin UPDATE is absent and own-profile editing still works.
- Re-run user-policy/catalog assertions in `docs/PHASE-4-STEP-2-TESTS.md`, `docs/PHASE-4-STEP-3-TESTS.md`, and `docs/PHASE-4-STEP-4-TESTS.md`.
- Re-run inactive/profile-less denial from `docs/PHASE-4-STEP-1A-TESTS.md` and the Step 10 gate if a shared helper changes.
- Re-run Batch 7 Users paging/search tests for both Admin and newly scoped Co-Admin views.
- Extend the future authoritative Phase 4B catalog test and allowlists for every new function/policy/grant; historical Phase 4 counts remain unchanged.

## Test deliverable

Create `docs/phase-4b/step-9-tests.md` when the batch lands. Include one self-contained rollback-safe Dev SQL paste ending in the intentional `TEST RESULTS` exception, route tests, and UI/manual coverage.

The SQL paste must cover this action × caller × target × committee matrix:

| Caller | Target/proposed role | Committee relation | View management row | Invite | Deactivate | Reactivate | Edit `full_name` | Change role | Move committee | Invite officer | Delete/anonymize |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Active Admin | Member | Any | Allowed by Admin scope | Member flow allowed | Admin contract | Admin contract | Admin contract | Deny (no generic change-role) | Allow only through Step 8 operation 4 (Members only) | Step 8 contract | Step 10 only |
| Active Admin | Admin/Co-Admin | Any | Allowed by Admin scope | Officer flow only | Step 8 rules | Step 8 rules | Admin contract | Deny (no generic change-role) | Deny (officers cannot be moved) | Step 8 only | Denied here |
| Active Co-Admin | Member | Own committee | Allow | Allow as Member in own committee | Allow | Allow if not anonymized | Allow | Deny (no generic change-role) | Deny | Deny | Deny |
| Active Co-Admin | Member | Other committee | Deny | Deny | Deny | Deny | Deny | Deny (no generic change-role) | Deny | Deny | Deny |
| Active Co-Admin | Admin | Any committee/null | Deny | Deny | Deny | Deny | Deny | Deny (no generic change-role) | Deny | Deny | Deny |
| Active Co-Admin | Co-Admin | Same or other committee | Deny | Deny | Deny | Deny | Deny | Deny (no generic change-role) | Deny | Deny | Deny |
| Active Member | Any | Same or other committee | Deny management list | Deny | Deny | Deny | Deny | Deny (no generic change-role) | Deny | Deny | Deny |
| Inactive Admin/Co-Admin | Any | Same or other committee | Deny | Deny | Deny | Deny | Deny | Deny (no generic change-role) | Deny | Deny | Deny |
| Profile-less authenticated user | Any | Same or other committee | Deny | Deny | Deny | Deny | Deny | Deny (no generic change-role) | Deny | Deny | Deny |

“Admin contract” and “Step 8 contract” cells are regression assertions owned by their respective batches, not new Step 9 permissions. Add stale-state cases where an own-committee Member becomes a Co-Admin, moves committee, is anonymized, or the caller loses Co-Admin/active status before submission; every stale request must fail without a partial write.

The prototype's “Change Role” action in `docs/prototypes/user-management.html` is not built and must not be copied.

## Manual checklist

- As a Co-Admin, verify `/users` shows only Members in the caller’s own committee across Active and Deactivated tabs.
- Search for a known same-committee Member beyond page one and confirm server-wide tab search finds them; search for another committee or officer and confirm no result/count leak.
- Invite a Member without sending role or committee authority from the browser; confirm the created profile is a Member in the caller’s current committee.
- Deactivate and reactivate an own-committee Member, then edit only their full name.
- Attempt direct requests against an Admin, Co-Admin, other-committee Member, anonymized Member, and stale target. All must fail.
- Confirm no Co-Admin UI or API permits any officer operation, deletion, or anonymization.
- As inactive Co-Admin, Member, and profile-less user, confirm the page and every mutation fail closed.
- As Admin, re-run the established User Management actions to catch regressions without treating Step 9 as authority for unresolved Step 8 role transitions.

## Acceptance

An active Co-Admin can perform exactly five management capabilities within their own committee: view Members, invite Members, deactivate Members, reactivate Members, and edit `full_name`. Database and server boundaries deny every officer, role, committee, deletion, anonymization, out-of-committee, inactive, and profile-less path. Batch 0’s broad-update removal remains intact, and the complete role/target/committee matrix passes.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod status without owner confirmation.
- Add `docs/phase-4b/step-9-tests.md` and update the authoritative Phase 4B catalog/allowlists when scheduled.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` to replace the older Admin-only/current broad-Co-Admin descriptions with the verified narrow RPC boundary.

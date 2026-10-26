# Step 9: Co-Admin user management

**Status:** Database migration and SQL paste drafted locally; owner review pending | **Branch:** `feature/coadmin-user-management` | **Reasoning level:** High (security-critical migrations and tests)

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
- Admin Member invites retain a required real-committee selector. Co-Admin Member invites send no role or committee authority; the server and database derive `role = 'Member'` and the caller's current committee.
- Co-Admin Member deactivation changes only `is_active`. It does not clear the profile avatar, remove the Storage avatar, or ban/unban Auth; Batch 10 owns former-member avatar cleanup and Batch 14 owns the deferred ordinary-Member Auth-ban decision.
- The fixed-shape reader is the User Management boundary. The older same-committee `users` SELECT policy remains unchanged for other features and must not be used as the Co-Admin management projection.

## Current state

- Current `users` SELECT RLS lets a Co-Admin see every profile in their committee, including another Co-Admin, rather than a Member-only management projection.
- Batch 0 removed `co_admin_update_own_committee_members`, revoked direct authenticated `users` UPDATE, and retained safe own-name editing through `update_own_profile(text)`. Batch 9 must preserve that boundary.
- `/users` is currently active-Admin-only, loads the Admin's RLS-visible profiles, and uses an Admin-only invite dialog and activation route. Its page and invite guard already use the Batch 0 active-profile helper.
- `src/lib/nav.ts` currently exposes User Management only to Admins, while `proxy.ts` is session refresh rather than a role allowlist. The UI checkpoint must add Co-Admin to the `/users` nav item and change the page plus `/api/users` guards to active Admin/Co-Admin; Members remain excluded by both navigation and page/route guards.
- `/api/invite` currently accepts a client-supplied role and committee and uses service role. Batch 9 cannot expose that contract to Co-Admins; a Co-Admin Member invite must derive `role = 'Member'` and the caller’s committee server-side.
- `/api/toggle-user-active` is currently active-Admin-only and uses service role to update the profile and remove an avatar on deactivation.
- Batch 7 owns Active/Deactivated tabs, whole-tab server search, and fetch-21/show-20 Users paging. Batch 9 must extend that safe paging pattern to Co-Admin scope rather than create a second unpaged list.

## Scope: in / out

**In:** Co-Admin access to `/users`; Member-only rows from the caller’s current committee; Active/Deactivated tabs and Batch 7 paging/search within that scope; Member invite with server-derived role and committee; Member deactivate/reactivate; `full_name` editing only; matching desktop/mobile actions and failures; Admin regression behavior; SQL and route tests for every caller/target/committee combination.

**Out:** viewing or managing Admins/Co-Admins through the Co-Admin management surface; every Step 8 officer operation; email editing; avatar editing; password state; Discord ID; deletion or anonymization; member removal (Batch 10); any direct Co-Admin UPDATE policy on `users`.

## Database impact

The drafted migration is `20261026150000_coadmin_user_management.sql`. It creates `list_managed_users(boolean,text,integer)`, `finalize_member_invite(uuid,text,text,uuid)`, `deactivate_committee_member(uuid)`, `reactivate_committee_member(uuid)`, and `update_committee_member_full_name(uuid,text)`. It creates or replaces no policy and does not change Step 8's `guard_officer_user_writes()` or `set_officer_active(uuid,boolean)`.

The three Member writers reject a caller who is not an active Co-Admin before taking the shared Step 8 advisory lock, then take that lock, re-check the caller, and finally lock/re-read the target's role, committee, and active state. They require a same-committee Member and update exactly one approved field/state. The full-name writer copies `update_own_profile(text)` normalization and writes only `full_name`; the activation writers accept no role or committee parameter and write only `is_active`. The migration deliberately does not reference or add `anonymized_at`; Batch 10 must replace/extend the shared reactivation boundary once the marker exists.

Member invitation necessarily uses a server-only Auth Admin call. The route must first verify an active Admin/Co-Admin, reject client role authority, require a real selected committee for Admin, derive the current non-null committee for Co-Admin, and invite the normalized email. `finalize_member_invite` rejects unauthorized callers before waiting for the shared officer lock and re-checks them after taking it, requires a matching `auth.users` row that is an unconfirmed, invited, never-signed-in account, rejects an existing profile or live officer invitation by UUID/normalized email, and inserts only an active `Member` profile.

Batch 7 used a raw RLS-backed query rather than a database reader. The new fixed-shape `list_managed_users` reader derives caller scope and returns only fields required by User Management: Admins keep all-user scope, while Co-Admins receive only same-committee Members. A Co-Admin with a null committee, an inactive caller, a Member, or a profile-less caller receives zero rows. It preserves 21-row lookahead and whole-tab search, and uses literal `strpos` matching so `%`, `_`, and `\` cannot become wildcard syntax.

## Route and UI implementation

- The database migration is approved, applied on Dev, and passed the fixed 116-line SQL paste (owner-confirmed). The route/UI layer is implemented locally pending the final browser review and merge.
- `/users` and `/api/users` admit active Admins and Co-Admins. Initial reads, tab changes, search, and fetch-21/show-20 paging use `list_managed_users` with the caller session. Admin rows retain the exact seven fields and all-role/all-committee ordering/search behavior used by the existing table/cards; Co-Admins receive the Member-only database projection.
- `/api/invite` rejects client role authority for both roles and client committee authority for Co-Admins. Before `inviteUserByEmail`, it fails closed on a service-role lookup for a live officer invitation with the normalized email: a match returns the safe `CCM07` conflict and a lookup error returns a generic retry response, with no Auth invitation sent. It then uses server-only `inviteUserByEmail` and calls `finalize_member_invite` with the caller session; the finalizer's `CCM07` check remains authoritative. `CCM06` and `CCM07` never trigger Auth deletion. Other failures delete only after a fresh service-role check proves the Auth user is unconfirmed and never signed in, has no profile, and has no live officer invitation by UUID or normalized email; any failed check returns cleanup-attention without deletion.
- `/api/toggle-user-active` branches only on the server-read active caller profile. Its Admin branch retains officer/Auth/avatar behavior; its Co-Admin branch calls only `deactivate_committee_member` or `reactivate_committee_member` with the caller session and accepts no avatar authority. `/api/update-member-name` is Co-Admin-only and calls only `update_committee_member_full_name`, returning the normalized name for immediate display.
- The shared desktop table and phone cards receive one explicit viewer role. Admin officer/pending-invite actions remain Admin-only; Co-Admins receive only Edit name and Deactivate/Reactivate. The Co-Admin invite form shows the committee as read-only text and submits neither role nor committee.

## Guards that must remain true

- Allowed Co-Admin actions are exactly: view own-committee Members, invite Members into that committee, deactivate Members, reactivate Members, and edit `full_name` only.
- A Co-Admin cannot see a management row for an Admin or Co-Admin, including one sharing their committee.
- A Co-Admin cannot target a Member from another committee even with a guessed UUID, stale browser data, or a direct request.
- Role and committee are server-derived for Co-Admin invites. Client-supplied values cannot widen authority.
- Every Step 8 officer operation remains outside Co-Admin authority.
- Batch 0’s removal of direct Co-Admin UPDATE remains in place. UI hiding is not the security boundary.
- Inactive and profile-less callers receive no rows and cannot call any writer or service-role route.
- An anonymized account can never be reactivated; Batch 10’s marker must be honored by the shared activation boundary.
- A Co-Admin deactivation does not clear an avatar or ban/unban Auth in Batch 9. The inactive profile remains the immediate application boundary.
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

The drafted `docs/phase-4b/step-9-tests.md` contains one self-contained rollback-safe Dev SQL paste ending in the intentional `TEST RESULTS` exception. It expects exactly 116 counted lines: 81 matrix cells, 5 stale-state cases, 11 reader/search/paging cases, 15 catalog/boundary cases, and 4 explicit Auth/profile/officer-reservation invite-finalizer identity cases. The count is identical whether the conditional anonymization case runs or prints `ANONYMIZED_CASE: SKIPPED (column absent)`.

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
- **Admin list unchanged:** verify Active and Deactivated tabs still include Admin, Co-Admin, and Member rows from every committee in `full_name, id` order; search separately by name, email, role, and committee name; load page 2; and confirm desktop/phone fields and actions match the pre-Batch-9 Admin surface.

## Acceptance

An active Co-Admin can perform exactly five management capabilities within their own committee: view Members, invite Members, deactivate Members, reactivate Members, and edit `full_name`. Database and server boundaries deny every officer, role, committee, deletion, anonymization, out-of-committee, inactive, and profile-less path. Batch 0’s broad-update removal remains intact, and the complete role/target/committee matrix passes.

## Open questions for the owner

None.

## Deferred account-management items

- A mistyped Member email cannot be re-invited because the profile already exists. Until a later correction workflow is approved, deactivate the incorrect profile rather than deleting it.
- Co-Admin deactivation changes only `is_active`: it does not clear the profile/Storage avatar and does not ban or unban Auth. Keep that asymmetry for Batch 9; Batch 14 owns both the Co-Admin Member-avatar decision and ordinary-Member Auth ban/unban.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod status without owner confirmation.
- Add `docs/phase-4b/step-9-tests.md` and update the authoritative Phase 4B catalog/allowlists when scheduled.
- Update `docs/ARCHITECTURE.md` and `docs/DATABASE.md` to replace the older Admin-only/current broad-Co-Admin descriptions with the verified narrow RPC boundary.

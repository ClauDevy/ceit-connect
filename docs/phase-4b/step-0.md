# Step 0: Users authorization fix

**Status:** Planned | **Branch:** `fix/users-authz` | **Reasoning level:** High (security-critical migration, route guards, and tests)

## Goal

Remove the broad direct Co-Admin `UPDATE` path on `users`, preserve safe own-profile editing, and make both the invite route and Users page require an active authorized profile. This is the first Phase 4B batch and must land before later account-management work.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Batch and audit resolutions

- Batch 0 is `fix/users-authz` and is security-critical.
- Remove direct Co-Admin `UPDATE` on `users` while preserving own-profile editing.
- `/api/invite` and `/users` must use the active-profile role guard rather than checking only that an Auth session exists.
- RLS and server authorization remain the security boundary; hiding the page or controls is only UX.

## Current state

- The tracked `co_admin_update_own_committee_members` policy allows a Co-Admin to update same-committee profile rows directly. Its `WITH CHECK` blocks promotion to Admin but still permits changes to other security-relevant columns and can affect another Co-Admin.
- `src/app/api/invite/route.ts` performs server-only invitation work and uses the service-role client, but Batch 0 must ensure an active Admin is re-verified before that client is constructed or used.
- `src/app/(dashboard)/users/page.tsx` is Admin-only in intent but must use `getActiveProfileForRoles(["Admin"])` itself because layout redirects do not guard pages rendered in parallel.
- Settings and avatar flows already provide own-profile behavior that must keep working without restoring a general `users` update policy.

## Scope: in / out

**In:** one new tracked migration removing the direct Co-Admin update policy; the narrow own-profile boundary needed by existing Settings behavior; active-Admin guards on `/users` and `/api/invite`; guard ordering before service-role use; focused RLS, route, page, and regression tests.

**Out:** Co-Admin User Management, officer role operations, role caps, account anonymization, Google sign-in changes, redesign work, or any remote Supabase command.

## Database impact

Create a new security-critical migration. Do not edit an applied migration.

- Drop `co_admin_update_own_committee_members` and do not replace it with another broad same-committee policy.
- Preserve only an explicitly narrow own-profile editing path for approved non-security fields. It must derive the target from `auth.uid()` and must not accept or change `role`, `committee_id`, `is_active`, email authority, password state, or any later anonymization marker.
- Keep Admin and self-read behavior needed by the current application, without treating the Admin policy as authority for later officer transitions.
- Update the future Phase 4B catalog allowlist for the exact final policies, grants, functions, and signatures.

## Guards that must remain true

- A Co-Admin cannot directly update any other user, including a same-committee Member or Co-Admin.
- Own-profile editing cannot change `role`, `committee_id`, or `is_active`, including through a forged direct request or raw authenticated update.
- `/users` handles a null active-role result and redirects or denies access; it never relies on a parent layout.
- `/api/invite` verifies logged-in state, `role = 'Admin'`, and `is_active = true` with the caller-scoped client before constructing or using `createServiceRoleClient()`.
- Member, inactive, and profile-less callers cannot load the Users page or invoke the invite operation.
- Every Supabase result is checked and client submissions retain `try/catch/finally` behavior.

## Security risks

- Replacing the old policy with another row-wide Co-Admin update would preserve the privilege-escalation bug under a new name.
- A route that checks only session existence lets a deactivated Admin continue using service-role operations.
- Trusting a client role, committee, target id, or active state bypasses the intended server and RLS boundary.
- An own-row policy without a column-safe writer could let any user promote, move, or reactivate themselves.

## Earlier test docs to re-run or update

- Re-run the users-policy and inactive/profile-less portions of `docs/PHASE-4-STEP-1A-TESTS.md`, `docs/PHASE-4-STEP-2-TESTS.md`, and the Step 10 gate where their assertions remain applicable.
- Preserve existing Settings/avatar regression coverage and the invite rollback/error contract.
- Add the final objects to the future Phase 4B catalog without rewriting historical Phase 4 result counts.

## Test deliverable

Create `docs/phase-4b/step-0-tests.md` when the batch lands. Include one independently rollback-safe Dev SQL paste ending in the required intentional `TEST RESULTS` exception, plus route/page tests.

Cover active Admin, inactive Admin, Co-Admin, Member, profile-less, and unauthenticated callers; direct updates against self and same/other-committee targets; attempted changes to every protected field; safe approved own-profile editing; page-level guard behavior; service-role guard ordering; malformed invite bodies; checked Supabase failures; and unchanged Admin invite success.

The SQL suite must explicitly prove that own-profile editing cannot change `role`, `committee_id`, or `is_active`.

## Manual checklist

- As an active Admin, open `/users` and complete a valid Member invitation.
- As an inactive Admin, Co-Admin, Member, profile-less user, and signed-out user, try the page and direct invite request; all must fail before privileged work.
- As each role, edit an approved own-profile field and confirm it still saves.
- Attempt to change the caller's own role, committee, and active state through direct requests; all must fail.
- Confirm invite failures still roll back only newly created half-accounts and never delete an established user.

## Acceptance

No Co-Admin has direct `UPDATE` access to another `users` row. Approved own-profile editing still works but cannot change `role`, `committee_id`, or `is_active`. The Users page and invite route independently require an active Admin, and the invite route performs that verification before any service-role use. The focused security and regression suites pass without changing remote projects.

## Open questions for the owner

None.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev or Prod application without owner confirmation.
- Add `docs/phase-4b/step-0-tests.md` and update `docs/DATABASE.md` plus the future Phase 4B catalog for the final policy and writer inventory.

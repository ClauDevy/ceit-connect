# Step 7: Accounts polish

**Status:** Implemented locally; owner browser gate pending | **Branch:** `feature/accounts-polish` | **Reasoning level:** High (security-critical admission and tests)

## Goal

Polish account management without weakening the invite-only boundary: split User Management into Active and Deactivated tabs, page and search each tab on the server with the shared fetch-21/show-20 pattern, show a warning dot on every Settings entry until the signed-in user has set a password, remove the old password prerequisite from Google sign-in, and keep an OAuth session only for a verified, active, invited profile whose email matches on a lowercase comparison and whose domain is allowed in the current environment.

## Decisions

### `docs/PHASE-4B-PLAN.md` — Batches

- Batch 7 owns Active/Deactivated tabs, Users paging, the Settings password warning dot, no temporary password, and secure invited-user Google sign-in.

### `docs/PHASE-4B-PLAN.md` — Updates (latest decisions)

- There is no temporary password. “Allow new users to sign up” is disabled in Dev and Prod.
- An invited user may continue with Google or set their own password. `/auth/callback` has no password gate and does not rely on `app_metadata.provider`.
- The callback keeps a session only for an active matching profile on an allowed domain. Negative tests cover uninvited, deactivated, profile-less, and wrong-domain users.
- The Settings warning dot remains until a password is set.
- Users paging belongs to Batch 7.

### `docs/PHASE-4B-PLAN.md` — Audit resolutions

- Batch 7 is security-critical.
- Google sign-in uses the active-profile, matching-email, allowed-domain boundary; signup remains disabled in both environments.
- Linear lists use 20 visible rows with a 21st-row lookahead. Users paging is implemented here.

### Owner clarifications for Step 7

- Compare Auth and profile emails after trimming and lowercasing; a case-only difference is the same address.
- Require `email_confirmed_at` before retaining the callback session.
- Search the entire selected Active/Deactivated tab on the server, not only the rows already loaded.
- Show the password warning dot on every Settings entry, including desktop and mobile navigation, until `password_set = true`.

## Current state

- `src/app/api/invite/route.ts` lowercases only the extracted domain for its allowlist check. It passes the entered email unchanged to `inviteUserByEmail()` and stores that unchanged value in `public.users.email`.
- `public.users.email` is plain `text not null`; tracked migrations define no lowercase constraint, normalization trigger, or unique constraint. Existing profile rows may therefore retain entered casing.
- `src/app/auth/callback/route.ts` currently exchanges the code, reads `app_metadata.provider`, and applies its extra checks only when that value equals `google`. It looks up the profile by Auth UUID, selects only `password_set`, requires a password, and never compares Auth email with profile email, checks `is_active`, checks `email_confirmed_at`, or applies `ALLOWED_EMAIL_DOMAINS`.
- The callback currently deletes a profile-less Auth user through the service-role client after sign-out. Batch 7 must remove that deletion path: the product never deletes users, and disabled signup should prevent a new uninvited OAuth account from being created in the first place.
- Supabase documents that disabling **Allow new users to sign up** permits only existing Auth users to sign in. It also documents automatic linking of a new OAuth identity to an existing user with the same verified email. The callback remains the application’s defense in depth for profile, active-state, email, verification, and domain checks.
- `src/app/(dashboard)/users/page.tsx` currently loads every RLS-visible profile ordered by `full_name`; `src/components/users/users-table.tsx` searches that in-memory array and mixes active and deactivated rows.
- The current Users page and invite route use role-only checks. Batch 0 must first replace these with the active-profile guard and remove direct Co-Admin `users` updates.
- `password_set` already exists and is backfilled by `20261001135007_add_password_set_column.sql`. Settings already reads it, but current navigation data does not carry it and no Settings entry renders a warning dot.
- No invite or password flow generates a temporary password today; this batch must preserve that behavior.

## Scope: in / out

**In:** Active and Deactivated tabs; one server-side query per selected tab/search/page; case-insensitive search across the whole selected tab; `full_name` ordering with a stable `id` tie-breaker; fetch 21, render 20, advance by 20; reset paging when tab/search changes; warning dots on every desktop/mobile Settings entry; normalized lowercase email comparison; verified-email, active-profile, allowed-domain callback checks; removal of the password and provider-metadata gates; sign-out on every rejected exchanged session; Dev `gmail.com` support through environment configuration and Prod exclusion through its stricter allowlist.

**Out:** officer invites and role changes (Batch 8); Co-Admin User Management (Batch 9); former-member anonymization (Batch 10); temporary passwords; public signup; changing the environment allowlists in code; Activity Log paging; Kanban paging.

## Database impact

No migration is expected solely for callback admission or Users paging. Existing RLS-backed queries can filter by `is_active`, search safe profile fields, order by `full_name, id`, and request 21 rows. New invitations must store the trimmed lowercase email, while callback comparison also normalizes both sides so legacy mixed-case profile rows remain usable.

If implementation discovers that a database reader or email invariant is required, add a new tracked migration; do not edit an applied migration. Any such migration and its tests require High reasoning and must preserve the Batch 0 users-policy boundary, active/profile-less denial, exact grants, fixed search paths, and zero unintended function overloads.

## Guards that must remain true

- Treat `/auth/callback` as an admission boundary after code exchange. Keep the session only when the Auth user has a non-empty email, `email_confirmed_at` is non-null, a profile with the same UUID exists, the profile is active, normalized Auth/profile emails match, and the normalized domain is in `ALLOWED_EMAIL_DOMAINS`.
- Never use `app_metadata.provider` for authorization and never require `password_set` for Google admission.
- On every rejection after exchange, check the sign-out result and redirect to a non-sensitive login error. Never delete the Auth user from the callback.
- Disabled signup is the upstream control: an uninvited Google address must not be auto-created. The callback still rejects any existing profile-less Auth account.
- An unverified Auth email, missing email, inactive profile, missing profile, mismatched normalized email, or wrong domain must fail closed.
- Dev may admit `gmail.com` only because Dev’s allowlist includes it. Prod must not admit it when Prod’s allowlist omits it. An empty/missing allowlist must fail closed rather than allow every domain.
- Fetch 21, render only 20, and advance by 20. The lookahead row must not be rendered or counted until the next page.
- Tab and normalized search are server inputs with bounded length. Changing either resets accumulated pages; append must deduplicate by UUID.
- The warning dot is UX only. Password state never becomes an authorization gate.

## Security risks

- OAuth code exchange creates a session before application admission checks. Any early return that omits sign-out can leave a rejected browser authenticated.
- Relying only on disabled signup would not reject a pre-existing profile-less Auth row. Relying only on the profile UUID would not catch a stale or changed profile email.
- Exact case-sensitive comparison would reject the same mailbox when only casing differs; comparison must use trimmed lowercase values on both sides.
- `ALLOWED_EMAIL_DOMAINS` must be normalized, non-empty, and evaluated server-side. Never send it or the service-role key to the browser.
- Do not expose whether a specific email has an Auth row or profile through detailed login errors.
- Server-side search must remain within RLS and return only the selected status. Do not fetch all profiles and hide unauthorized rows in the client.
- Check every Supabase result, including profile reads and sign-out. Do not restore the callback’s service-role deletion behavior.

## Earlier test docs to re-run or update

- Re-run the user-policy/catalog assertions in `docs/PHASE-4-STEP-2-TESTS.md`, `docs/PHASE-4-STEP-3-TESTS.md`, and `docs/PHASE-4-STEP-4-TESTS.md` after Batch 0 and this batch.
- Re-run the inactive/profile-less gates referenced by `docs/PHASE-4-STEP-1A-TESTS.md` and `docs/PHASE-4-STEP-10-TESTS.md` if any shared active-profile helper or users policy changes.
- Update auth/manual coverage that still says Google requires `password_set` or magic-link-first.
- If a migration is added, re-run the Step 10A catalog paste and update only legitimately changed Phase 4B expectations; historical Phase 4 counts remain historical.

## Test deliverable

Create `docs/phase-4b/step-7-tests.md` when the batch lands. It must include rollback-safe SQL/catalog coverage for any migration plus focused route/component tests for callback admission, normalized email/domain handling, paging, search, tabs, and warning dots. Callback negatives must include uninvited email, deactivated profile, profile-less Auth user, wrong domain, unverified email, missing email, and a true normalized-email mismatch; a case-only difference must pass. Also prove the callback does not inspect `app_metadata.provider`, does not read `password_set`, and never calls Auth deletion.

## Manual checklist

- In Dev, test an invited active university address and an invited active `gmail.com` address with Google; both may pass only when their Auth email is verified and matches the profile after lowercase normalization.
- Test the four required negatives: uninvited email, deactivated user, profile-less user, and wrong-domain user. Confirm each returns to login and has no retained app session.
- Test unverified email, missing email, true email mismatch, and case-only difference. Only the case-only difference may pass.
- Confirm Prod configuration does not include `gmail.com`; do not change or print environment secrets while checking.
- Verify Google works while `password_set = false`, while the Settings warning dot remains visible until the user sets a password.
- Verify the warning dot appears on every desktop and mobile Settings entry, disappears after `password_set` becomes true, and returns only if the stored flag is false.
- For each Users tab, test 0, 1, 19, 20, 21, 40, and 41 matches; exact multiples; stable ordering; repeated Load more; tab changes; empty search; no matches; errors and retry.
- Confirm search finds matches beyond the first loaded page and never crosses the selected Active/Deactivated status.

## Acceptance

Only an existing verified Auth user with an active matching profile and an allowed normalized domain retains the OAuth callback session. The callback has no password or provider-metadata gate and never deletes users. Users are separated into searchable server-paged Active/Deactivated tabs with 20 visible rows and correct lookahead behavior. Every Settings navigation entry shows the password warning dot exactly while `password_set` is false.

## Open questions for the owner

- None. The owner resolved email normalization, email verification, paging/search, and warning-dot placement for this step.

## Docs to update when this lands

- Update this file and `docs/PROGRESS.md` only after implementation and verification; do not claim Dev/Prod status without owner confirmation.
- Add `docs/phase-4b/step-7-tests.md`.
- Update stale Google/password wording in `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, and the `docs/PROGRESS.md` decisions log only when the batch lands.
- Record any Dashboard-only Auth configuration verification in `docs/GOTCHAS.md` without exposing project secrets.

## Implementation result

- Callback admission follows one ordered fail-closed path for non-empty verified Auth email, same-UUID active profile, normalized email equality, and normalized allowed domain. Every rejection after exchange checks sign-out and returns `error=auth`; old callback error links are generic. No provider metadata, `password_set`, service-role client, or deletion path remains.
- The invite and callback share the same trim/lowercase/empty-removal allowlist parser. Invite behavior otherwise remains unchanged, including its separately tracked Batch 14 empty-allowlist issue and its checked rollback of a newly created half-account when profile insertion fails.
- User Management defaults to Active and offers a Deactivated tab. The server validates status, a 20-row-aligned offset capped at 10,000, and a 100-code-point search; safely quotes PostgREST grammar; escapes literal ILIKE wildcards; resolves matching names from the authenticated 12-row committees lookup; and makes one RLS-backed Users query for 21 rows ordered by `full_name, id`.
- The client reuses the Batch 3P paging hook/helpers, renders 20, advances by 20, resets on tab/search identity, cancels stale requests, deduplicates UUIDs, refreshes page one after status mutations, uses `TabPanel` only for explicit tab choices, and retains stable-ID list reveal with reduced-motion final states.
- The shell carries `password_set` as `CurrentUser.passwordSet`. The shared accessible reminder appears in the desktop sidebar, mobile bottom/More renderers, and mobile avatar menu only while false; it never gates access. First-password success refreshes server state, and Settings no longer says a password enables Google.
- No migration, database reader, policy, grant, overload, temporary password, Supabase command, Dev change, or Prod change was made.


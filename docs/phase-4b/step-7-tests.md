# Step 7 tests: Accounts polish

**Status:** Batch 7's focused automated coverage passes. The full repository run retains two previously documented unrelated collection failures; owner browser checks remain pending. No Dev or Prod result is claimed.

## Automated coverage

- Callback: missing code; upstream uninvited/exchange failure; exchange success without a user; missing/empty email; unverified email; profile read error; profile-less Auth user; inactive profile; true normalized mismatch; wrong domain; malformed multi-`@` email; missing/empty allowlist; case/space-only match; allowed-domain normalization; safe `next`; exact `email, is_active` profile selection; no provider/password gate; checked sign-out error on every post-exchange rejection; no service role or deletion.
- Login errors: `auth`, legacy `not_invited`, and legacy `set_password_first` all resolve to the same generic message.
- Users server contract: active-Admin guard, GET-only route, `Cache-Control: no-store`, status/search/offset validation, offset multiple and upper bound, checked committee lookup, one Users query, selected-status predicate, `full_name, id` ordering, fetch 21, and safe errors.
- Search grammar: exact filter strings for literal `%`, `_`, `\`, `"`, comma, parentheses, and dot; two-layer ILIKE/PostgREST escaping; strict database-sourced committee UUID validation; case-insensitive literal committee-name matching; 100-Unicode-code-point cap.
- Paging/UI contracts: shared fetch-21/show-20 helpers cover 0/1/19/20/21/40/41 boundaries, exact multiples, offset advancement, stale-response rejection, UUID deduplication, retry, and announcements. Users keeps the existing action/avatar coverage and adds Active/Deactivated tab, stable-ID reveal, and warning metadata coverage.
- Warning dot: accessible label, Settings-only navigation metadata, false/true shell data flow, and production type/build coverage for desktop sidebar, mobile bottom/More, and avatar menu.

## Manual browser rows — owner pending

Use Dev only: Admin `admin@test.com` / Claudee, Co-Admin `cia-coadmin@test.com` / Claude HAAAA, and Member `coexa-member@test.com` / tv. Test phone and desktop widths, light and dark themes, then repeat the motion rows with reduced motion.

- [ ] A fresh Dev invite email link still signs in and reaches the app.
- [ ] Password sign-in remains unaffected for all three existing test accounts.
- [ ] Invited active university and Dev-allowed Gmail users can use Google while `password_set = false`; the dot remains until a password is set.
- [ ] Uninvited, deactivated, profile-less, wrong-domain, unverified, missing-email, and true-mismatch callbacks return the same generic login message and retain no app session. A case-only difference passes.
- [ ] Active and Deactivated tabs show only their selected status and preserve `full_name, id` ordering.
- [ ] For each tab, verify 0, 1, 19, 20, 21, 40, and 41 matches; exact multiples; Load more retry/loading/final states; UUID deduplication; and reset after tab/search changes.
- [ ] A committee-name search finds matching people beyond page one without crossing status; name, email, and role search also span the full selected tab.
- [ ] Searching literal `%`, `_`, `\`, and `"` returns no wildcard matches and no parsing error.
- [ ] Explicit tab selection uses the shared panel motion; search, Load more, retry, and mutation refresh do not replay it. Reduced motion shows final tab/list states immediately.
- [ ] The password-warning dot appears in the expanded/collapsed desktop sidebar, mobile Settings tab, and mobile avatar-menu Settings link while false, then disappears everywhere immediately after first-password success.
- [ ] Co-Admin and Member cannot open User Management or call `/api/users`; the warning dot never changes authorization.

## Database impact

None. There is no SQL paste, migration result count, reader replacement, policy change, grant change, or overload inventory change for this batch.

## Gate results

- Focused tests: 94/94 pass across 12 Batch 7 and shared-contract files.
- `npm test`: 331 tests pass; collection still fails for the two pre-existing unrelated unresolved-`@/` imports in `src/components/shared/load-more-control.test.tsx` and `src/lib/tasks/backup.test.ts`.
- `npm run build`: passes with Next.js 16.3.4 and all 24 routes, including `/api/users`.
- `npm run lint`: passes with zero reported issues.
- `git diff --check`: passes (Git reports only the repository's CRLF-conversion notices).

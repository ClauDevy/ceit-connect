# Phase 5 Step A — Sign out and draft Terms

## Status

Implemented locally on 2026-11-17. This work is not live on Dev or Prod.

## Approved behavior

- The More-sheet Sign out control is separated below Help, has a 44px phone
  target, uses the real `PushAwareSignOutForm`, and has no sheet-closing click
  handler. The form remains mounted while best-effort push cleanup runs and
  until the browser starts the native POST.
- Settings keeps its existing grid. Help and Terms stack on phones and sit
  beside each other from `sm`; the final full-width section contains only
  Sign out and uses motion index 6.
- The login Terms link is a plain normal-flow link rendered only by
  `sign-in-panel.tsx`. The login footer, viewport recovery, sizing, and scroll
  behavior are unchanged.
- `/terms` reads the optional Supabase user in `try/catch`. A returned auth
  error or thrown exception is treated as signed out. The page never redirects;
  only its back-link destination and label change.
- The Terms copy is limited to behavior verified in the code and project docs.
  It makes no retention, Activity Log, data-sharing, or security promise.

## Placeholders

- Terms: `[contact email to be confirmed]`
- README: `[license to be confirmed]`

No other placeholder is used.

## Automated coverage

- Mobile More renders the real push-aware form and stays mounted during cleanup.
- Settings renders its Help, Terms, and final Sign out controls with the user ID.
- Terms renders without a session, changes only its back link for a valid user,
  and treats returned or thrown auth errors as signed out.
- Login and Help render their Terms links without changing the protected footer
  or existing role tests.
- Existing auth and branding tests are unchanged.

## Automated verification

- `npx.cmd tsc --noEmit` passed.
- `npm.cmd run test` finished at 1,500/1,504 passing across 142 files, with
  exactly the four known CRLF-sensitive migration-contract failures and no new
  failure.
- `npm.cmd run lint` exited zero with only the existing unused `INK` warning in
  `src/components/ui/mascot.tsx`.
- `git diff --check` passed; Git printed only its informational README
  LF-to-CRLF working-copy warning.
- No build, Supabase command, commit, browser check, or manual check was run.

## Manual checks — not yet run

- Signed-out `/terms`, including the draft notice and `/login` back link.
- Signed-in `/terms`, including the `/home` back link.
- Login Terms link and installed-app phone scrolling.
- Settings Help/Terms layout and Sign out on phone and desktop.
- Help footer Terms link.
- Phone More ordering, 44px Sign out target, push cleanup, and native sign-out.
- Keyboard focus plus light and dark appearance.

## Deferred and out of scope

- `src/components/layout/sidebar.tsx` remains unused and retains its legacy
  non-push-aware form.
- The open installed-app login scroll bug is not changed.
- Settings' existing ignored profile-query error is not changed.
- The existing unused `INK` lint warning and four CRLF-sensitive test failures
  remain baseline items.

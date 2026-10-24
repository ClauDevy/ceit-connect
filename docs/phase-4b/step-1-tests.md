# Step 1: UI bug fixes and cleanup — verification

**Status:** In progress — Part A implemented locally | **Branch:** `fix/ui-bugs`

This document is updated after each of the three owner-reviewed parts. It does not claim Dev or Prod deployment.

## Baseline before Batch 1

`npm.cmd run lint` completed with zero errors and exactly three warnings:

1. `src/components/auth/password-sign-in-form.tsx:37:5` — `@next/next/no-location-assign-relative-destination`.
2. `src/components/auth/reset-password-flow.tsx:66:7` — `@next/next/no-location-assign-relative-destination`.
3. `src/lib/supabase/middleware.ts:34:13` — `@typescript-eslint/no-unused-vars`.

The separate development warning is the raw theme `<script dangerouslySetInnerHTML>` in `src/app/layout.tsx`. Part B owns all four warning sources.

## Part A — avatar and User Management

### Automated

- Pure helper tests prove the fixed `<user_id>/avatar.webp` path, exact object matching, preference for the object's `updated_at`, and the `created_at` then server-time fallbacks.
- Route tests prove signed-out, inactive, and profile-less callers are denied before service-role construction.
- Route tests prove client-supplied URL/version fields are ignored and the returned/stored URL is derived from the authenticated user's object and its Storage timestamp.
- Route tests prove a missing fixed object returns a checked safe error without updating the profile.
- Route tests prove removal clears `users.avatar_url` before attempting Storage deletion, returns a non-blocking retry marker when cleanup fails, and skips deletion when the database update fails.
- Server-rendered markup tests prove both desktop and phone User Management renderers pass `avatar_url` to `UserAvatar`.
- Users-page tests prove the member query selects `avatar_url` and a query failure renders a safe error rather than an empty roster or raw database detail.

Focused Part A result before the full gate: 4 files, 20 tests passed.

### Manual only

- Upload a first avatar and then overwrite the same fixed Storage path. Confirm Settings uses the route-returned URL and the new photo appears after refresh.
- Confirm both User Management layouts, desktop/mobile headers, task cards, assignee and viewer lists, comments, event forms, and archives show the new photo rather than a stale image or initials.
- Trigger a missing-object save and confirm the safe error is actionable without exposing Storage details.
- Trigger a Storage cleanup failure during removal. Confirm the avatar disappears from the profile, a non-blocking warning appears, and **Retry photo cleanup** safely succeeds later.
- Trigger committee and member query failures separately. Confirm User Management shows the safe load error and does not show `No members yet`.

## Part A changed files

- `src/app/(dashboard)/users/page.tsx`
- `src/app/(dashboard)/users/page.test.tsx`
- `src/app/api/update-avatar/route.ts`
- `src/app/api/update-avatar/route.test.ts`
- `src/components/settings/avatar-uploader.tsx`
- `src/components/users/members-table.tsx`
- `src/components/users/members-cards.tsx`
- `src/components/users/members-avatar.test.tsx`
- `src/lib/avatar.ts`
- `src/lib/avatar.test.ts`
- `src/lib/types.ts`
- `docs/phase-4b/step-1.md`
- `docs/phase-4b/step-1-tests.md`
- `docs/PROGRESS.md`

## Part A command gate

- `npm test` — passed: 18 files, 236 tests.
- `npm run build` — passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` — passed with zero errors and exactly the three pre-existing warnings assigned to Part B. Part A introduced no warning.

## Later parts

- Part B will record the no-import proof for external `cn` and `p`, package removal, auth-navigation regression coverage, theme initialization, middleware session refresh, and the final zero-warning lint result.
- Part C will classify its pure/markup checks as automated and real-browser interaction checks as manual only, including search focus/debounce/polling and crop dragging.

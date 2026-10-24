# Step 1: UI bug fixes and cleanup — verification

**Status:** Parts A, B, and C implemented locally | **Branch:** `fix/ui-bugs`

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

## Part B — warnings, auth navigation, and unused packages

### Automated

- A pure navigation test proves successful authentication replaces the current screen with `/home` and then refreshes the client route cache, preventing reuse of a signed-out layout.
- A server-rendered root-layout test proves the inline theme script has the required `ceit-theme-init` id, contains the bootstrap body, and appears directly in `<head>` before `<body>`.
- The production build proves the direct root-head script compiles without the former placement warning or a hydration build error.
- Middleware still awaits `supabase.auth.getUser()`, checks its error, and treats a missing signed-out session as expected while reporting other refresh failures.
- Separate repository searches found no double-quoted or single-quoted ESM/CommonJS import of external `cn` or `p`. There are 28 imports of the local `@/lib/utils` helper.
- `npm ls cn p --depth=0` reports an empty top level after removal, and neither package remains in `package.json` or its own lockfile entry.

### Manual only

- Complete password sign-in and password reset. Confirm each reaches a freshly authenticated `/home`, then use Back and confirm the completed auth screen is not restored.
- Force incorrect credentials, a failed reset response, and a network failure. Confirm the relevant button is released and can be retried.
- With DevTools closed, verify signed-in back/forward behavior still follows the existing `BfcacheGuard` contract.
- In both light and dark OS/browser states, hard-load development and the production build. Confirm the initial theme is applied before paint with no flash or hydration warning in the browser console.
- Allow an authenticated session refresh and load a signed-out public page. Confirm middleware still refreshes cookies and does not log the expected missing-session case as an error.

## Part B changed files

- `src/components/auth/password-sign-in-form.tsx`
- `src/components/auth/reset-password-flow.tsx`
- `src/lib/auth-navigation.ts`
- `src/lib/auth-navigation.test.ts`
- `src/app/layout.tsx`
- `src/app/layout.test.tsx`
- `src/lib/supabase/middleware.ts`
- `package.json`
- `package-lock.json`
- `docs/phase-4b/step-1.md`
- `docs/phase-4b/step-1-tests.md`
- `docs/PROGRESS.md`

## Part B command gate

- `npm test` — passed: 20 files, 238 tests.
- `npm run build` — passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully, with no root-script warning.
- `npm run lint` — passed with zero errors and zero warnings.

## Avatar cleanup retry review follow-up

### Automated

- Pure-helper tests prove a failed retry preserves the existing warning, `cleanupPending: false` clears it, and `cleanupPending: true` keeps or updates it.

### Manual only

- With a cleanup warning visible, retry removal against a network failure and a non-OK response. Confirm the warning stays visible, the retry button is disabled only in flight, and it becomes available again afterward.

### Command gate

- `npm test` — passed: 20 files, 242 tests.
- `npm run build` — passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` — passed with zero errors and zero warnings.

## Part C — interaction and presentation fixes

### Automated

- Pure-function tests cover Enter suppression for search fields, landscape/portrait/small-image minimum contain zoom, and Philippine-time timestamp serialization/splitting including an invalid timestamp.
- All eight search inputs use the same Enter-suppression helper. Focus identity while typing, debounce, polling, and refetch remains a real-browser check.
- `renderToStaticMarkup` proves the shared stretched-link pattern keeps its sibling action outside the link, shared phone buttons/inputs carry 44px minimum sizing, Drive preview markup is width-contained with its escape link, and all five current loading states expose distinct route-shaped structure.
- Repository inventory confirms all eight navigating cards/rows use the shared overlay link, with their independent buttons, links, drag handle, and select controls positioned above it.
- The timestamp audit found no browser-timezone formatter. Timestamp parsing now uses shared `Asia/Manila` helpers; date-only event values retain their deliberate UTC-midnight formatting so `yyyy-mm-dd` dates cannot shift.

### Manual only

- Exercise all eight search fields through continuous typing, debounce, visible polling, focus refetch, Enter, and clearing. Confirm the same input remains focused and the surrounding form never submits.
- Use mouse, keyboard, middle-click, and phone taps on all eight navigating cards/rows. Confirm the whole box navigates and each sibling action works independently without a nested-interactive warning.
- Measure representative buttons, icon buttons, inputs, selects, mobile navigation, and the mobile profile link at phone width; confirm targets are at least 44 by 44 CSS pixels.
- Pick portrait, landscape, square, and small avatar images as the first selection and as replacements. Confirm each starts zoomed out enough to show the whole image, and crop dragging/saving remains correct.
- Visit the dashboard fallback, Home, Settings, task detail, and User Management loading states in both themes and at phone width; confirm their geometry matches the final route.
- Open representative Drive file, folder, Docs, Sheets, and Slides links at a narrow phone width. Confirm the preview and fallback never create horizontal page overflow.
- Check comment Edit/Delete controls at desktop and phone widths. Confirm they remain right-aligned without changing authorization or confirmation behavior.
- Compare Live Operation and displayed task/comment timestamps from browsers set to different local timezones; values must remain fixed to Philippine time.

## Part C changed files

- `src/app/(dashboard)/archives/[eventId]/page.tsx`
- `src/app/(dashboard)/archives/page.tsx`
- `src/app/(dashboard)/events/[eventId]/edit/page.tsx`
- `src/app/(dashboard)/home/loading.tsx`
- `src/app/(dashboard)/home/page.tsx`
- `src/components/events/event-board-task-card.tsx`
- `src/components/events/event-form.tsx`
- `src/components/layout/mobile-topbar.tsx`
- `src/components/settings/avatar-cropper.tsx`
- `src/components/settings/avatar-uploader.tsx`
- `src/components/shared/page-skeleton.tsx`
- `src/components/shared/stretched-link.tsx`
- `src/components/shared/ui-regressions.test.tsx`
- `src/components/tasks/archived-task-sharing.tsx`
- `src/components/tasks/drive-preview.tsx`
- `src/components/tasks/help-wanted-list.tsx`
- `src/components/tasks/my-tasks-list.tsx`
- `src/components/tasks/task-comments.tsx`
- `src/components/tasks/task-detail-skeleton.tsx`
- `src/components/tasks/task-edit-controls.tsx`
- `src/components/tasks/task-people-controls.tsx`
- `src/components/tasks/your-work-card.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- `src/components/ui/select.tsx`
- `src/components/ui/touch-targets.test.tsx`
- `src/components/users/users-table.tsx`
- `src/lib/image.ts`
- `src/lib/image.test.ts`
- `src/lib/search.ts`
- `src/lib/search.test.ts`
- `src/lib/timezone.ts`
- `src/lib/timezone.test.ts`
- `docs/phase-4b/step-1.md`
- `docs/phase-4b/step-1-tests.md`
- `docs/PROGRESS.md`

## Part C command gate

- `npm test` — passed: 25 files, 255 tests.
- `npm run build` — passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` — passed with zero errors and zero warnings.

## Part B review follow-up — theme timing and recovery verification

### Automated

- The root-layout static-markup test proves `ceit-theme-init` is a direct inline script inside `<head>` before `<body>`.
- After a clean Next.js 16.3.4 production build, fetching `/login` from `next start` placed the theme script at byte 1455, before `</head>` at byte 1758 and `<body>` at byte 1765. No `self.__next_s` queue preceded or wrapped the theme script.
- `npm test` — passed: 25 files, 255 tests.
- `npm run build` — passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully, with no script-placement or hydration warning.
- `npm run lint` — passed with zero errors and zero warnings.

### Manual only

- With dark theme saved, hard-refresh `/login` and confirm no light-theme frame appears before the dark theme. The production HTML proves synchronous head placement, but visual first-paint behavior requires a real browser.
- Submit an invalid recovery code and simulate a thrown/network failure during verification. Confirm the existing returned-error message remains unchanged, the thrown failure shows the safe retry message, and the Verify button is released in both cases. React state behavior is manual only because this batch does not add jsdom or a browser renderer.

## Part C review follow-up — dates, crop bounds, and link focus

### Automated

- Pure event-form helpers prove the Due date field's `yyyy-mm-dd` value reaches the task payload unchanged. Archived-template date-only input and a full timestamp both normalize to the same `2026-10-24` Manila date before reaching that payload. No event `start_date`/`end_date` behavior changed.
- The cropper remains configured with `minZoom` and `restrictPosition={false}`, matching the installed `react-easy-crop` 6.2.3 API for zoom below 1 and positioning beyond the image boundary.
- Pure crop planning proves a negative-origin 150-by-150 crop around a 100-by-50 image creates a square output, places the undistorted image at `(25, 50)`, and leaves the remaining cleared canvas transparent. The WebP output preserves alpha; a future non-alpha output format would flatten those pixels according to that encoder.
- The contain-zoom tests cover landscape, portrait, square, and smaller-than-crop images. The implementation deliberately uses `Math.min(1, crop.width / media.width, crop.height / media.height)`; changing it to the larger ratio would violate the owner-approved whole-image view.
- Server-rendered link markup proves the stretched focus target keeps `ring-2` and `ring-ring`, adds `ring-inset`, and has no ring-offset class that could be clipped outside its card or row.
- `npm test` — passed: 26 files, 260 tests.
- `npm run build` — passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` — passed with zero errors and zero warnings.

### Manual only

- In the avatar cropper, zoom portrait, landscape, square, and small images fully out and move them beyond the crop boundary. Confirm saving produces a square, undistorted image with transparent padding where the crop extends past the source.
- Keyboard-focus each whole-card/row link inside both clipped and unclipped containers. Confirm the two-pixel inset focus ring remains fully visible.

## Batch 1 owner follow-up — banner contain crop and phone PDF frame

### Automated and inspected

- Pure-function tests cover wide and tall source images contained inside a 16:9 banner frame and prove an out-of-source banner crop keeps a 16:9 output with undistorted image placement and transparent margins.
- The banner cropper uses its own `minZoom`, applies the smaller contain ratio after both media and crop-frame sizes are known, and sets `restrictPosition={false}`. The avatar cropper is unchanged.
- A headless-Chrome check generated a transparent 3200-by-1800 WebP, forced the production banner settings (`maxSizeMB: 1.45`, `maxWidthOrHeight: 1920`, WebP), decoded the resulting 1920-by-1080 file, and measured alpha. The transparent corner remained `0`; the image center remained `255`. Compression therefore does not flatten padding to black or white.
- Server-rendered Drive-preview markup proves the iframe uses a phone `3/4` portrait ratio, restores `16/10` at `sm`, remains width-contained, and retains both “Preview unavailable?” and “Open link”.
- Production `/login` HTML still emits `ceit-theme-init` as a plain inline script at byte 1455, before `</head>` at 1758 and `<body>` at 1765, with no preceding `self.__next_s` queue. The theme implementation is unchanged.
- `npm test` — passed: 26 files, 263 tests.
- `npm run build` — passed with Next.js 16.3.4; TypeScript and all 23 generated routes completed successfully.
- `npm run lint` — passed with zero errors and zero warnings.

### Manual only

- Crop tall, wide, square, and small banner images on first selection and through Adjust crop. Confirm each can show the whole source, transparent letterboxing reveals the semantic banner gradient cleanly in both themes, and the resulting upload stays below 1.5 MB.
- On a real phone, open the reported Drive PDF. Confirm both horizontal page edges remain visible while the document scrolls vertically inside the portrait viewer, and confirm the hint and Open link still work.
- With dark mode saved, reload under network throttling and confirm there is no white flash or hydration warning. The production HTML proves pre-body execution; first-paint appearance remains a browser-only check.

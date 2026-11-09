# Phase 5 N3b — notification housekeeping UI

Branch: `feature/notification-housekeeping-ui`

N3b consumes the two live N3a owner RPCs and adds no database object, migration,
policy, grant, Realtime DELETE listener, or Supabase setting.

## Fixed behavior

- Every desktop-popover and phone-sheet row has a separate Delete button. It is
  never nested in the task link, has a 44 px minimum touch target, and names the
  complete notification sentence for assistive technology.
- `delete_notification(uuid)` treats both `true` and `false` as success. A
  malformed response changes nothing locally, starts safe count/list refetches,
  and shows fixed error copy. A database error retains the row.
- A successful single-row delete removes that row locally, then refetches the
  unread count and page one. If older pages were loaded, their cursor and unique
  rows remain available. Focus moves to the next Delete button, then the previous
  one, or the panel heading when no row remains.
- Clear read is shown only while the list contains rows. Its inline flow is
  `Clear read` → `Confirm clear read` plus `Cancel`. It resets on Cancel, group
  blur, Escape, five seconds, panel close, and unmount; timeout/Escape returns
  focus from Confirm to Clear read while the panel remains open.
- `clear_read_notifications()` may return a non-negative safe integer for
  information only. A malformed count is ignored. Success authoritatively
  replaces the loaded list with fresh page one because locked rows may remain;
  failure retains every local row.
- Delete/Clear successes use fixed polite announcements; failures use the visible
  alert with fixed safe copy. The visible
  notice states: “Deletion is permanent. Unread notifications are never
  removed.” The badge still comes only from `get_notification_unread_count()`.
- Realtime remains personal INSERT-only invalidation. Opening the panel, window
  focus, and visible-again recovery authoritatively replace the list with page
  one. Therefore any loaded older pages collapse on those recovery paths; this
  is intentional so deletions made on another device cannot remain cached.
- `No notifications yet` remains legal only when the count is exactly zero.
  Positive/unknown count plus an empty page retains the safe Refresh state.

## Automated coverage

The N3b rendered tests use `happy-dom` only through their file-level Vitest
environment directive. They cover the exact Prod-shaped microsecond row, delete
success/false/failure/malformed results, loaded-page settlement, focus, busy
double activation, delete during mark-one, two-step Clear read and every reset
path, malformed informational counts, Clear failure, focus/visibility recovery,
fixed announcements, and the existing empty-state safety rule.

Verification result: all 1,186 tests across 113 files pass. Lint has zero
errors and one unrelated existing `src/components/ui/mascot.tsx` unused-`INK`
warning. Direct `npx.cmd tsc --noEmit` reaches only the already-documented
missing Next-generated `PageProps`/`LayoutProps` globals in the two dynamic
dashboard pages and root layout. No build was run by owner instruction.

## Manual checklist

1. On desktop, open the bell, load an older page, delete a row, and confirm the
   task does not open, the next sensible Delete control receives focus, the badge
   refetches, and Load more continues without duplicates.
2. On a phone-sized viewport, repeat Delete in the sheet and confirm its touch
   target is comfortable, keyboard/screen-reader name is complete, and the row
   link remains independent.
3. Arm Clear read, then separately verify Cancel, focus leaving the group,
   Escape, five seconds, and closing/reopening the panel all restore the initial
   action. Confirm timeout/Escape focus returns to Clear read.
4. Confirm Clear read once. Verify unread rows remain, the fixed permanent-delete
   notice stays visible, and the list returns to authoritative page one even if
   older pages had been loaded.
5. With the panel open, delete a notification in another session. Return focus
   and repeat after hiding/showing the tab; each recovery must drop loaded older
   pages and show authoritative page one without the deleted row.
6. In reduced-motion mode, repeat Delete and the Clear disclosure. Content and
   focus must settle immediately without spatial or disclosure animation.

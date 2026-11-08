# Phase 5 N2: notification bell

**Branch:** `feature/notification-bell`  
**Reasoning:** Medium for UI behavior  
**Scope:** desktop bell, phone sheet, paged notification list, unread badge,
read-state actions, current-user Realtime invalidation, offline recovery,
accessibility, shared motion, tests, and docs. N2 adds no database object.

## Goal and boundary

N2 renders the durable rows already owned by N1. It calls only
`get_notification_unread_count`, `list_notifications`,
`mark_notification_read`, and `mark_all_notifications_read`. It does not add or
change SQL, RLS, triggers, notification generation, retention, email, Discord,
push, dashboards, or installable-app behavior.

The unread badge comes only from `get_notification_unread_count`. Realtime
payloads never enter the list and never change a client counter; an INSERT for
the current user only refetches the readers. Refresh, focus, visible-again,
browser-online, Realtime resubscription/error/timeout, and Auth token refresh
recover missed work from the database. One provider above both responsive
headers owns one deduplicated live channel and cleans it up on unmount.

## Placement and presentation

- Desktop places the bell between the theme toggle and identity card and opens
  an anchored Base UI 1.8.0 popover.
- Phone places the bell between the theme toggle and avatar and opens the
  existing viewport-safe bottom sheet.
- The visible badge stops at `99+`; a polite live region announces the database
  count, including “99 or more.”
- Empty successful results use the existing compact `EmptyState`.
- Rows show an unread dot, the approved sentence, and one render-time relative
  timestamp. There is no ticking timer.
- React renders every reader title as plain escaped text. The visual sentence
  may clamp, while its accessible label contains the complete sentence.

Approved copy:

- mention: “You were mentioned in {task title}.”
- heads-up: “A teammate sent a heads-up on {task title}.”
- assignment: “You were assigned to {task title}.”
- status change: “The status changed for {task title}.”
- unlock: “{task title} is ready to continue.”
- backup request: “{task title} needs backup.”

Masked and hidden rows receive `Confidential Task` from N1. A non-null task ID
is a real `/tasks/{id}` link for Active and Archived tasks alike. A null task ID
never renders a link and an unread hidden row instead has an accessible Mark as
read button.

## Paging, refresh, and read settlement

Every page requests 21 and displays 20. The twentieth displayed row supplies
the next exact `(created_at,id)` keyset cursor; the sentinel is never skipped
into the cursor. Appends deduplicate by notification ID.

A first-page refresh replaces matching IDs with current reader values and
keeps every older loaded row. When older pages exist, their oldest cursor and
`hasMore` state remain intact; only a one-page list adopts the refreshed first
page cursor. Failed count, refresh, or append calls keep the last successful
state and show fixed safe copy.

After the database confirms mark-one or mark-all, loaded rows become read
locally for display and both readers refetch. This local row state never changes
the badge. Mark all is enabled when the count reader says greater than zero or
has not produced a valid count, never because loaded rows look unread.

Ordinary activation of an unread linked row waits for mark-read success, then
closes and navigates. Failure leaves it unread and does not navigate.
Ctrl/Cmd/Shift/middle-click retains native browser behavior while starting the
same writer in the background. Per-row busy state prevents duplicate writers.

## Failure and session behavior

All request and mutation paths validate runtime response shapes, retain prior
state on failure, use fixed safe messages, and clear busy state through
`finally`. Notification RPC `42501` denial invokes a route refresh so the
existing dashboard boundary signs out and redirects an inactive session.
Database messages are never displayed.

The N1 count and mark-all functions return PostgreSQL `bigint`. The client
currently accepts only a nonnegative safe JavaScript number. The Dev manual
gate must confirm that this is the actual Supabase/PostgREST runtime format; a
text result fails closed until the validator and its tests are deliberately
updated to the observed single format.

## Accessibility and motion

The bell, close controls, linked rows, hidden-row actions, loading state, and
mark-all action have accessible names and keyboard behavior. Opening moves
focus to the notification heading; Escape/outside activation closes; focus
returns to the bell. Navigation closes the surface.

The Base UI popup/sheet uses the shared entrance/exit variables and ending
styles. Stable row IDs use `useListReveal`; refresh, Realtime, settlement, and
paging do not replay already revealed rows. Reduced motion removes popup,
sheet, row, and spinner movement and exposes every final state immediately.

## Automated and manual acceptance

Unit and source-contract tests cover strict readers/writers, six messages,
fetch-21/show-20, cursor choice, dedupe, refresh-with-older-pages, local read
settlement without badge arithmetic, personal invalidation-only Realtime,
offline/focus/visibility/token/channel recovery, dev double-mount channel
dedupe, cleanup, native modified activation, double-activation guards,
desktop/mobile placement, hidden non-links, accessible full copy, and motion.

Manual acceptance covers desktop, phone, keyboard, screen reader, online/live,
offline then reconnect, malformed/network failure, Active/Archived/masked/
hidden rows, dark mode, and reduced motion. Dev must also inspect the actual
unread-count JSON value and confirm it is a number before rollout.

The owner will remove N1 Prod smoke-test events through normal app screens
before N2 reaches Prod. This is operational cleanup, not N2 code or migration.

## Verification commands

Run only:

1. `npx.cmd tsc --noEmit`
2. `npm.cmd run test`
3. `npm.cmd run lint`
4. `git diff --check`

No build, Supabase command, commit, or push belongs to this implementation run.

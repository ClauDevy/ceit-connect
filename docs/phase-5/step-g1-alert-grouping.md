# Phase 5 G1 — alert grouping for push bursts

**Status:** Implemented locally; owner-run Dev SQL pastes pending  
**Branch:** `feature/alert-grouping`  
**Reasoning:** High

## Goal and fixed boundary

G1 groups only phone pushes. Every notification remains one unchanged bell row with the same unread state, target, tolerant parser behavior, and deletion lifecycle. There is no new notification type, public table shape, RLS policy, service-role path, quiet-hours behavior, email behavior, or service-worker target pattern.

Only Draft-to-Active launch `assignment`, `task_due_soon`, `live_operation_prep`, and `unlock` pushes group. Normal assignment changes and every other type remain individual and immediately eligible.

The group key is person plus notification type plus a first-notification-anchored window. New notifications may join only while the window is younger than 25 seconds. Delivery remains due at 30 seconds, leaving a five-second claim margin. A later notification starts a new UUID window. All grouped queue rows use the same `retry_deadline_at`, exactly one hour after the window started.

One grouped row keeps today's exact body, access-aware target, and queue-row delivery ID. Two or more rows return one counts-only summary per subscription with `/` as the target and the window UUID as `out_delivery_id`. That existing field is already the sender's tag, so a retry replaces itself and a later window cannot overwrite it. The public claim signature remains thirteen OUT columns; no application deployment is required.

## Exact copy

Title is always `CEIT Connect`.

- `assignment`: `You were assigned to {count} tasks.`
- `task_due_soon`: `{count} tasks are due within 24 hours.`
- `live_operation_prep`: `{count} Live Operation call times are within 2 hours.`
- `unlock`: `{count} of your tasks are now unlocked.`

Every summary body is counts-only and cannot contain a task title. Title and body remain below the worker's 80/240-character limits.

## Launch-only assignment marker

`notify_event_launch()` writes the current `xid8` to zero-policy private table `ceit_connect_private.push_launch_group_context` only around its direct assignment insert. The enqueue trigger consults that table and the function removes the row on success or error. Browser roles and service role have no table privilege. A caller-controlled custom GUC is deliberately not trusted.

Normal assignment notifications still enter through `insert_notifications` without a context row and remain individual.

## Queue, claim, acknowledgement, and retry

Migration `20261120120000_alert_grouping.sql` adds nullable `group_window_id` and `group_window_started_at` only to the private queue. Rows already pending or leased when the migration is applied retain nulls and follow the old individual path through claim, acknowledgement, expiry recovery, cleanup, and final state.

The enqueue trigger serializes one person's type window with an advisory transaction lock. All grouping work remains inside its existing catch-all block, so a grouping failure can never roll back the bell notification. Two concurrent large transactions can acquire different people's group locks in opposite order. PostgreSQL may detect a deadlock; the enqueue handler swallows it, so one push can be lost while its bell row remains. The owner accepts this bounded limitation.

The claim function authenticates the sender before every mutation or lock. Its leader test ignores earlier delivered, terminal, or leased rows and considers only rows still pending. Claim leases every member for one window and subscription with one token, then returns one delivery. Two subscriptions share the same window UUID but receive different lease tokens. Acknowledgement requires the logical delivery ID plus its token and updates only that subscription's group.

For one grouped row, the logical delivery ID is the queue row ID. For summaries it is the window ID. `acknowledge_push_delivery` accepts either. Transient retry returns every member to one retry time; success/permanent failure finalizes every member together; 404/410 keeps the existing subscription-removal behavior. Expired leases are released and reclaimed together.

If every notification in a due group is read, claim marks every pending member `terminal/all_read` and returns no push. If only some are read, the summary still counts every notification in the window, including the already-read rows. Bell rows and the database-owned unread count do not change.

Run `claimed_count`, `delivered_count`, retry, terminal, and expired-subscription counters count logical window/subscription deliveries, not underlying queue rows. Thus one six-alert window on two devices is two claims, not twelve.

## Old and new function contracts

| Function | Latest old definition | Owner and grants | Old behavior | G1 behavior |
| --- | --- | --- | --- | --- |
| `ceit_connect_private.notify_event_launch()` | `20261110120000_notification_foundation.sql`, lines 367–392, 26 lines | `postgres`; no `PUBLIC`, `anon`, `authenticated`, or `service_role` execute | Direct set-wise launch assignment insert | Same rows and filtering, surrounded only by the private transaction context |
| `ceit_connect_private.enqueue_notification_push()` | `20261112120000_web_push_database.sql`, lines 709–744, 36 lines | `postgres`; no application-role execute | Every eligible subscription row immediately uses its own delivery timing | Approved types obtain/reuse a 25-second-open window, become due at 30 seconds, and share the window's one-hour retry deadline; every failure remains best effort |
| `public.claim_push_deliveries(integer)` | `20261118120000_mention_notification_comment_targets.sql`, lines 448–620, 173 lines | `postgres`; capability-authenticated `anon` execute only | One queue row becomes one 13-column claim | One pending leader leases one row or one whole window/subscription; all-read groups finish silently; single rows return row ID and summaries return window ID; return shape, SQLSTATEs, generic single copy, J1 targets, grants, and denial text stay unchanged |
| `public.acknowledge_push_delivery(uuid,uuid,text,integer)` | `20261112120000_web_push_database.sql`, lines 935–1041, 107 lines | `postgres`; capability-authenticated `anon` execute only | One row is finalized or retried | Row ID or window ID plus lease token finalizes/retries only that logical subscription delivery; run counters increment once |

This four-function approach replaces the fewest large functions. Replacing `insert_notifications` would also require its latest J1 signature and every caller while still leaving enqueue, claim, and acknowledgement changes necessary.

The full LF-only SQL is the tracked migration `supabase/migrations/20261120120000_alert_grouping.sql`. It contains no `E'...'` strings and no `session_user = 'postgres'` requirement.

## Historical SQL paste expectations

Applied historical pastes are not edited.

| Existing paste | G1 effect and rerun instruction |
| --- | --- |
| `step-n1-notification-foundation-catalog-tests.md` (30/30) | No G1 timing expectation changes. It is historical after J1's signature replacement; do not use it as the G1 gate. |
| `step-n1-notification-foundation-behavior-tests.md` (48/48) | Launch still creates the same assignment bell rows and inactive filtering, so its G1-relevant expectations remain unchanged. Do not rerun it instead of the G1 behavior paste. |
| `step-p1a-web-push-database-catalog-tests.md` (44/44) | The sender signature, grants, trigger attachment, and queue security remain compatible. It is historical and is not the G1 catalog gate. |
| `step-p1a-web-push-database-behavior-tests.md` (61/61 before G1) | Its six-type immediate claim now leaves the direct `unlock` fixture held for 30 seconds, so untouched checks expecting six immediate claims, the immediate unlock copy, and six-row run counts are no longer authoritative. Do not rerun unchanged; G1 behavior rows 05–15 replace those expectations. |
| `step-r1-request-notifications-catalog-tests.md` (25/25) | No change: all five R1 types stay individual and immediate. |
| `step-r1-request-notifications-behavior-tests.md` (38/38) | No change: request types and the normal assignment created by volunteer acceptance do not group. |
| `step-r2-deadline-reminders-catalog-tests.md` (25/25) | The same thirteen types, generic single copy, grants, and thirteen-column claim shape remain. |
| `step-r2-deadline-reminders-behavior-tests.md` (26/26 before G1) | Its final two reminder pushes are claimed immediately after insertion. Untouched after G1, row 23 fails because both are held; row 24 remains vacuously true, giving 25/26. Do not treat that as a product failure or edit the applied paste; G1 behavior rows 16–21 and 26 replace the push-timing expectations. |
| `step-j1-mention-comment-targets-dev-tests.sql` (23/23) | Mention stays immediate, the claim shape is unchanged, and the thirteen generic single-body arms remain exactly once. J1's 23/23 remains the targeted compatibility rerun after G1 if the owner wants an additional regression check. |

The authoritative G1 owner-run gates are `step-g1-alert-grouping-catalog-tests.md` at 24/24 and `step-g1-alert-grouping-behavior-tests.md` at 36/36. Both are one self-contained Dev-only Run-without-RLS paste with independent fixtures and an intentional rollback exception.

## Dev and Prod exercise

Dev has no push cron. Create a grouped burst, manually wake before 25 seconds and confirm no push, wait until at least 35 seconds from the first alert, then use the existing local manual wake. One alert keeps its single copy; multiple alerts produce one summary per enabled device.

Prod's existing 15-second due-work fallback observes `next_attempt_at`, so a grouped window normally wakes at approximately 30–45 seconds. No cron, Vault, worker, endpoint allowlist, or service-worker change is required.

G1 migration 82 must be pushed only after L1 migration `20261119120000_live_operation_timing_rules.sql`. The owner applies migrations; Codex does not run a Supabase command.

## Validation and rollout

Automated validation is limited to:

1. `npx.cmd tsc --noEmit`
2. `npm.cmd run test`
3. `npm.cmd run lint`
4. `git diff --check`

No build is run. There is no application deploy dependency because the claim return shape is unchanged; after review, apply migrations through L1 in timestamp order and then migration 82. Run the 24/24 catalog paste and 36/36 behavior paste on Dev before any Prod application.

Local results:

- `npx.cmd tsc --noEmit` reaches only the known missing Next-generated `PageProps`/`LayoutProps` globals in the two dynamic pages and dashboard layout.
- `npm.cmd run test` passes 1,360/1,363 tests; the remaining three failures are the documented unrelated J1 CRLF/fixture-order assertions.
- `npm.cmd run lint` passes with zero errors and the existing unused `INK` warning in `src/components/ui/mascot.tsx`.
- `git diff --check` passes.

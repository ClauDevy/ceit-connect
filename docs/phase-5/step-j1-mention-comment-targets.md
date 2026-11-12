# J1 mention comment targets — review record

Status: implemented locally; do not apply to Dev until the owner reviews the
full migration and the self-contained Dev paste.

## Exact OLD and NEW definitions

The complete definitions are kept as executable SQL rather than abbreviated
copies. Open the OLD source and the NEW migration with VS Code **Compare
Selected** for a literal side-by-side review:

| Function | Complete OLD definition (latest predecessor) | Complete NEW definition |
| --- | --- | --- |
| `ceit_connect_private.insert_notifications` | `supabase/migrations/20261116120000_deadline_reminders.sql` | `supabase/migrations/20261118120000_mention_notification_comment_targets.sql` |
| `ceit_connect_private.notify_task_comment` | `supabase/migrations/20261110120000_notification_foundation.sql` | `supabase/migrations/20261118120000_mention_notification_comment_targets.sql` |
| `ceit_connect_private.list_notifications_for_user` | `supabase/migrations/20261110120000_notification_foundation.sql` | `supabase/migrations/20261118120000_mention_notification_comment_targets.sql` |
| `public.list_notifications` | `supabase/migrations/20261110120000_notification_foundation.sql` | `supabase/migrations/20261118120000_mention_notification_comment_targets.sql` |
| `public.claim_push_deliveries` | `supabase/migrations/20261116120000_deadline_reminders.sql` | `supabase/migrations/20261118120000_mention_notification_comment_targets.sql` |

Those files contain the full bodies, declarations, attributes, owner changes,
revokes, and grants. The migration preflight requires exactly five functions
under those names, no overloads, and no dependent objects for the three
drop-and-recreate signatures. It then restores owner `postgres`, revokes
`PUBLIC`, `anon`, `authenticated`, and `service_role`, and restores only the
existing authenticated `list_notifications` grant and anon
`claim_push_deliveries` grant. The final replaced-function count is five; the
new anchor is a sixth function and is not a replacement.

## Every behavior difference

| Function | OLD | NEW | Unchanged |
| --- | --- | --- | --- |
| `insert_notifications` | Four arguments; inserted only user/type/task. | Fifth nullable comment argument; rejects a comment unless it is a same-task mention; inserts `comment_id`. | Thirteen-type allowlist, active recipients, actor exclusion, deduplication, fixed metadata error, volatility/security/path/owner/revokes. |
| `notify_task_comment` | Mention rows did not identify the source comment. | Mention calls pass `new.id`; newly enabled Heads Up still passes no comment. | Active-event gate, INSERT/new-mention diff, Heads Up recipients and exclusions, no self-notification. |
| private `list_notifications_for_user` | Six columns; current access controlled task ID/title. | Seven columns with nullable `out_comment_id`; only a real-access mention whose comment still belongs to the task exposes it. Masked/hidden/old/deleted targets return null. | Owner paging/order, current-title resolution, masked title, hidden task ID, stable security boundary. |
| public `list_notifications` | Six-column validated wrapper. | Seven-column wrapper forwards `out_comment_id`. | Active-profile gate, page/cursor validation and exact errors, authenticated-only execute. |
| `claim_push_deliveries` | Fixed `/notifications` target. | Hidden/null-task rows use `/`; real valid mention targets use `/tasks/{task}#comment-{comment}`; every other usable row uses `/tasks/{task}`. | Capability authorization remains before limit validation and before every lock/queue mutation; selection, cleanup, retry, lease, run accounting, endpoint/key output, generic title/bodies, errors, owner and anon-only grant. |

`claim_push_deliveries` adds, for each claimed row, one notification join and
one `task_content_access_for_user` call. Only a `mention` row with real access
and a non-null comment ID performs the matching-comment existence lookup.

All thirteen push types retain their exact generic body. `mention` alone may
receive the comment fragment. `heads_up`, `assignment`, `status_change`,
`unlock`, `backup_request`, `volunteer_offer`, `leave_requested`,
`leave_cancelled`, `leave_approved`, `leave_denied`, `task_due_soon`, and
`live_operation_prep` receive the task-only path when usable. Any type with
hidden content receives `/`. No title, comment body, person name, or other
confidential content is added to the payload.

## Schema, deletion, and access

This is a database change. `notifications.comment_id` is nullable and has a
foreign key to `task_comments(id) ON DELETE SET NULL`. A foreign key is useful
because a stored target can never point at an unrelated/missing comment;
`SET NULL` is required because comments can be deleted while the notification
must survive. Users are never hard-deleted, so no user-FK change is needed.

The existing authenticated notification UPDATE policy is `using (false)` and
raw UPDATE is revoked, but there is no notification UPDATE guard trigger. The
only notification trigger is after INSERT for push enqueue. PostgreSQL's
referential action runs internally; the Dev paste proves that deleting a
targeted comment sets the notification field to null. It also exercises task
and event deletion. The new FK references neither events nor tasks, so CCE09's
direct event/task FK and lock inventory is unchanged.

The anchor reader uses `task_content_access_for_user` and one fixed
`CCC01 / The target comment is unavailable.` denial for null/invalid input,
inactive or missing caller, masked/hidden/lost access, missing/deleted comment,
wrong task, and an impossible missing boundary. Its two window queries use the
exact `list_task_comments` order: `created_at DESC, id DESC`.

## Application and rollout

Bell parsing remains tolerant: it checks whether a type is known before
validating the row, so unknown types are skipped. The deployed parser also
ignores an extra `out_comment_id` because it destructures only known fields.
The new parser treats a missing field as null, so deploy the app first, then
apply migration 80. An old service worker ignores `targetPath` and opens `/`,
which is safe.

Both sender and worker accept only `/` or the exact UUID shapes
`/tasks/{UUID}` and `/tasks/{UUID}#comment-{UUID}`. They never accept a scheme,
host, query, encoded alternate path, or arbitrary fragment, preventing open
redirects. Database access masking decides whether any task/comment identifier
is emitted; the URL contains no confidential text.

The task page requests one page anchor and then one normal 25-row comment page.
It never downloads intervening pages. It scrolls/focuses and briefly highlights
the exact row, announces arrival, and provides **Back to newest**. Deleted or
edited targets fail safely; editing preserves the ID. Archived tasks work for
current authorized viewers. Lost-access, deactivated, and wrong-task targets
receive the same unavailable state. Old null-target notifications open the
task normally. Signed-out return is deferred; auth files are untouched.

## Verification scope

Automated coverage includes parser rollout tolerance, unknown-type skipping,
target allowlists, old-row fallback, bounded anchor shape, exact ordering
source contract, shared motion/reduced-motion CSS, migration privileges/counts,
and push payload validation. The Dev paste covers page boundaries 25/26 and
50/51, a timestamp tie, deleted comments, task/event deletion, masked access,
deactivated recipients, all thirteen generic push bodies, and catalog grants.

Not verified locally: applying the migration, live catalog dependency output,
PostgreSQL FK action behavior on Dev, actual capability claims, push delivery,
browser scroll/focus/visual timing, old installed-worker behavior, or signed-out
navigation. Those require the owner-reviewed Dev paste and later manual testing.

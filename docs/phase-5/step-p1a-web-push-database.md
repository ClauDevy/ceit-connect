# P1a web-push database rollout

P1a is database-only. It adds the subscription registry, delivery queue,
capability-authenticated sender RPCs, coalesced wake request, counts-only run
logbook, cleanup runner, and SQL verification. It does **not** add or change an
application route, service worker, Settings control, sign-out handler, or any
existing task/notification function. The only connection to existing
notification behavior is the new `AFTER INSERT` enqueue trigger.

## Security boundary

The sender uses the public Supabase anon key only to reach three RPCs:
`claim_push_deliveries`, `acknowledge_push_delivery`, and
`finish_push_delivery_run`. The anon key is not proof of identity. Each RPC also
requires `x-ceit-push-capability`, a separate random secret held only by the
server-side sender. The database stores a 32-byte random salt and SHA-256 hash,
never the raw capability. Both the current and next slots are hashed and
compared with a fixed 32-byte loop before either result is acted on.

Wrong capabilities receive the same generic `42501` denial. They are not
persisted: there is no wrong-secret table, counter, request body, IP address,
user agent, or presented-secret log. If the capability leaks, an attacker can
claim generic queued deliveries and mark them with allowed outcomes. They
cannot select arbitrary recipients, supply message text, read task titles,
query other tables, or use the service-role key. Rotate immediately using the
exact alternating-slot procedure below.

Provisioning sends only the salt and hash to the database:

```sql
select public.configure_push_sender_credential_hash(
  'current',
  1,
  '<64 lowercase hex characters: 32 random salt bytes>',
  '<64 lowercase hex characters: SHA-256(salt bytes || UTF-8 raw secret)>'
);
```

Generate the raw secret, salt, and hash outside Supabase. Put the raw secret in
the sender environment only; do not paste it into SQL, logs, docs, source,
`NEXT_PUBLIC_*`, or a database row. P1b must document the exact password-manager
or offline generation steps before the owner provisions either environment.

### Exact capability rotation

`generation` is unique across both slots, so do not copy generation `N+1` from
`next` into `current` while it still exists in `next`. Slots alternate; the
working secret does not need to be renamed.

Assume generation `N` is in `current`:

1. Generate a new raw secret, a new 32-byte salt, and
   `SHA-256(salt || UTF-8 secret)` outside Supabase.
2. Install generation `N+1` in the empty `next` slot:

```sql
select public.configure_push_sender_credential_hash(
  'next',
  (select coalesce(max(generation), 0) + 1
   from ceit_connect_private.push_sender_credentials),
  '<new-salt-hex>',
  '<new-hash-hex>'
);
```

3. Put the new raw secret in the sender's `PUSH_DB_CAPABILITY`, redeploy that
   environment, manually wake it, and confirm a claim/finish succeeds.
4. Retire the old slot only after that confirmation:

```sql
select public.retire_push_sender_credential('current');
```

The new secret remains in `next`; that is its active slot. For the following
rotation, put generation `N+2` into the now-empty `current` slot:

```sql
select public.configure_push_sender_credential_hash(
  'current',
  (select coalesce(max(generation), 0) + 1
   from ceit_connect_private.push_sender_credentials),
  '<following-salt-hex>',
  '<following-hash-hex>'
);
```

Deploy the following raw secret, verify it, then retire `next`:

```sql
select public.retire_push_sender_credential('next');
```

Continue alternating slots and strictly increasing generations. If a secret is
suspected leaked, shorten the verify window to one manual successful wake and
retire the leaked slot immediately afterward.

The rejected no-database-credential alternative was a database webhook that
posted complete delivery material directly to the sender. It would remove even
the anon key from the sender, but it would copy endpoint/key material into an
outbound database request and make retry, lease, acknowledgement, and deletion
races harder to control. The narrow hashed capability keeps the queue as the
single source of truth without making a service-role exception.

## Queue and message rules

The sender request is only a wake signal with the constant body `{}`. It never
accepts a recipient, endpoint, title, body, task title, or arbitrary message.
The sender can send only rows returned by `claim_push_deliveries`.

Every push uses title `CEIT Connect`, target `/notifications`, and exactly one
of these lock-screen bodies:

| Type | Body |
| --- | --- |
| `mention` | `You were mentioned in a task.` |
| `heads_up` | `A task you’re assigned to has a new heads-up.` |
| `assignment` | `You were assigned to a task.` |
| `status_change` | `A task you’re assigned to changed status.` |
| `unlock` | `A task you’re assigned to is now unlocked.` |
| `backup_request` | `A task needs backup help.` |
| `volunteer_offer` | `A task has a new volunteer offer.` |
| `leave_requested` | `A task has a new leave request.` |
| `leave_cancelled` | `A leave request was cancelled.` |
| `leave_approved` | `Your leave request was approved.` |
| `leave_denied` | `Your leave request was denied.` |

No task title, event name, person name, comment text, confidential content, or
task ID enters the push payload.

R1 extends the same fixed-copy boundary to the five request types above. The
event wording itself is the only outcome disclosed; no task or person metadata
is added.

The queue has foreign keys only to `notifications` and `users`; CCE09 and all
existing task/notification functions remain unchanged. Deleting a notification
through N3b or N3a cascades its pending or leased delivery. A later
acknowledgement for that missing delivery returns `false` quietly: no retry, no
error row, and no failure count. Claim also inner-joins the live notification,
active user, and current subscription, so deleted or deactivated work is never
returned.

Claims last two minutes. Transient network failures, 408, 425, 429, and 5xx are
the only retryable results. The eight-attempt schedule is 0, 30 seconds, 1, 2,
5, 10, 15, and 20 minutes, bounded by the row's one-hour deadline. Other 4xx
responses are terminal. A 404 or 410 removes that subscription and all its
queued work. Successful rows are retained three days; terminal rows seven days.

## Subscription ownership

Each active person may have at most five endpoints. The endpoint hash is unique
across the council. Registering the same physical/browser endpoint for a new
signed-in person atomically removes the old owner's outstanding deliveries and
transfers the subscription, preventing a shared device from receiving the
previous person's work. A person can list safe metadata and remove one or all
of their own subscriptions through active-user RPCs. Endpoint and encryption
keys are not browser-selectable columns.

P1b sign-out must remove only the current device's subscription through the
one-device removal function before ending the session; subscriptions on the
person's other devices are preserved. Independently, the database deactivation
trigger removes every subscription and queued row as soon as `users.is_active`
becomes false. Claim repeats the active check. Users remain in `users`; none is
hard-deleted. Explicit browser expiration timestamps and 404/410 responses both
remove expired subscriptions.

Registration accepts HTTPS endpoints only when the parsed host is exactly
`fcm.googleapis.com`, `updates.push.services.mozilla.com`,
`web.push.apple.com`, or has at least one valid DNS label before
`.notify.windows.com`. Userinfo, explicit ports, fragments, HTTP, lookalikes,
and all other hosts are rejected. `p256dh` must be unpadded base64url text 80–100
characters long; `auth_secret` must be unpadded base64url text 16–32 characters
long.

## Kick timing and proof

The enqueue trigger requests a sender wake immediately after it creates at
least one delivery. Wake requests use an exact **10-second coalescing window**:
the first insert locks and advances the singleton kick row; every insert in the
following ten seconds sees that timestamp and makes no HTTP request. The lock
uses `FOR UPDATE SKIP LOCKED`, so a concurrent transaction returns `false`
immediately instead of waiting. Paste B inserts a six-notification burst for one
subscription and proves both that six queue rows exist and that `request_count`
increases by exactly one.

Queue insertion and wake errors are contained inside the trigger. They never
roll back or block the original notification/task transaction. Every 15 seconds
the Prod fallback calls `request_push_kick_if_due()`. It wakes only when a
pending row is due now, still inside its retry window, and under eight attempts,
or when a lease has expired; it goes through the same non-waiting ten-second
coalescer. This catches work inserted near the trailing
edge of a coalescing window while keeping the delivery target under roughly 30
seconds.

## Per-environment configuration

Keep Dev and Prod completely separate:

| Value | Dev | Prod |
| --- | --- | --- |
| Supabase Vault `push_kick_url` | Deployed Dev sender URL. A localhost URL is not reachable from hosted Supabase. | Production sender URL. |
| Supabase Vault `push_wake_secret` | Dev-only random wake secret. | Different Prod-only random wake secret. |
| Sender `PUSH_WAKE_SECRET` | Same Dev wake secret; local value belongs only in `.env.local`. | Same Prod wake secret in the Production deployment environment. |
| Sender `PUSH_DB_CAPABILITY` | Dev raw capability matching the Dev hash. | Different Prod raw capability matching the Prod hash. |
| Sender Supabase URL/anon key | Dev project only. | Prod project only. |

Create/update the two Vault values in each project's Supabase Dashboard. Create
matching sender environment variables in the corresponding Vercel environment.
Do not reuse either secret across Dev and Prod.

When the app and P1b sender run on localhost, hosted Supabase cannot call
`localhost`. Leave Dev Vault pointed at the deployed Dev sender (or an approved
temporary HTTPS tunnel). To exercise the local sender, manually POST the
constant `{}` body from the owner's machine to
`http://localhost:3000/api/push/wake` with the Dev `x-ceit-wake-secret` header.
That manual wake only starts a claim; it supplies no recipient or message. Do
not place the wake secret in a browser URL or query string.

## Dev verification before any Prod work

1. Review the full migration.
2. Apply it to Dev using the owner-controlled Dashboard workflow.
3. Run Paste A with **Run without RLS** and expect exactly:
   `TEST RESULTS 44/44 PASS — transaction intentionally rolled back`.
4. Run Paste B the same way and expect exactly:
   `TEST RESULTS 61/61 PASS — transaction intentionally rolled back`.
5. Do not configure a Dev cron row. Test a wake manually when P1b exists.

No Dev push is authorized by this implementation handoff; the owner reviews the
full migration and both pastes first.

## Review delta: old versus new functions

| Function | Before this review | After this review |
| --- | --- | --- |
| `public.register_push_subscription(...)` | Checked only the `https://` prefix and broad non-empty key lengths. | Parses the authority, enforces the exact approved host allowlist, rejects userinfo/ports/fragments/HTTP/lookalikes, and requires bounded unpadded base64url `p256dh` and `auth_secret`. |
| `ceit_connect_private.authenticate_push_sender()` | Tried to increment a wrong-secret bucket that the caller’s `42501` rolled back. | Performs the same two fixed-length comparisons and returns `null` on failure without any database write; callers still emit the same generic `42501`. |
| `ceit_connect_private.request_push_kick(boolean)` | Waited on the singleton row with plain `FOR UPDATE`. | Uses `FOR UPDATE SKIP LOCKED`; a concurrent kicker is treated as already in progress and returns `false` immediately. |
| `ceit_connect_private.request_push_kick_if_due()` | Did not exist. | Returns `false` without a wake; otherwise sends pending work only when it is due now, still inside its retry window, and under eight attempts, or sends expired leases through the same ten-second coalescer. |
| `public.run_push_delivery_cleanup()` | Returned six counts, including deleted wrong-secret buckets. | Returns five counts; the wrong-secret output and retention work are removed with the table. |

## Prod-only schedules

After P1b is live and both Dev pastes and the P1b manual gate pass, create these
as two separate Prod `pg_cron` jobs. Dev gets neither job.

Create the delivery fallback exactly as follows. First remove any old job with
the same name (zero rows means there was none):

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'p1-push-delivery-fallback';
```

Then schedule the due-work helper every 15 seconds using `pg_cron` seconds
syntax. A pending delivery qualifies only when it is due now, still inside its
retry window, and under eight attempts; an expired lease also qualifies:

```sql
select cron.schedule(
  'p1-push-delivery-fallback',
  '15 seconds',
  $$select ceit_connect_private.request_push_kick_if_due();$$
);
```

Verify exactly one active row and its exact schedule/command before continuing:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'p1-push-delivery-fallback';
```

The cleanup has its **own** job at 12:25 AM Philippine time (16:25 UTC):

```sql
select cron.schedule(
  'p1-push-delivery-cleanup',
  '25 16 * * *',
  $$select * from public.run_push_delivery_cleanup();$$
);
```

The counts-only run log contains start/finish timestamps and aggregate claimed,
delivered, retry, terminal, expired-subscription, and unacknowledged counts. It
contains no user, notification, task, subscription, endpoint, or message field
and is retained for 30 days. No wrong-secret history is stored.

## P1b outline (not implemented here)

P1b adds the isolated sender wake route, Web Push/VAPID send loop, service
worker, and Settings enable/disable controls. The route validates only the wake
secret, accepts no delivery input, then claims with the database capability.
Sign-out removes only the current device's subscription through the one-device
removal function before the session ends; subscriptions on the person's other
devices are preserved.

On iPhone, Enable notifications appears only when the site is running as the
installed Home Screen app. Permission is requested synchronously from that
button tap, never on page load. Android and desktop use the same explicit tap.
Disable removes the current subscription from both browser and database.


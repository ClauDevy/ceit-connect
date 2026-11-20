# Phase 5 E1 — important email notifications

## Scope

E1 emails only `assignment`, `task_due_soon`, and `live_operation_prep`.
Email is an independent best-effort channel behind the existing bell row and
push enqueue. The database outbox contains no address or task content. A claim
reserves only queue identifiers; a separate capability-authenticated send
preparation then re-checks the current recipient, access, and confidentiality
immediately before Resend. It resolves only a confirmed Auth email matching the
active, non-anonymized profile. Confidential, hidden, or masked preparation
returns no title and only `/workspace`; preparation returns a title and exact
task path only when the recipient currently has `real` task-content access. A
30-second send guard temporarily rejects task deletion or changes to title,
confidentiality, committee, assignees, or allowed viewers; the worker starts
Resend only when that guard covers the provider's full timeout. Preparation
takes a task-row `FOR SHARE` lock before publishing that guard, matching the
task-before-queue mutation order and rereading content after any earlier writer
finishes. Notification deletion nulls only the queue's dedupe reference; the
task UUID and unexpired guard remain until delivery state cleanup.

Migration `20261126120000_email_queue_drop_task_fk.sql` removes the queue's
`task_id` foreign key after Dev exposed its conflict with the exact event-delete
FK inventory. `task_id` remains `uuid not null` with a normal lookup index.
Preparation returns no row when that task has since been deleted, so the app
can terminate the leased delivery without exposing content or blocking event
deletion. The same corrective migration replaces the applied claim and purge
functions without changing their public contracts. Claim no longer finalizes a
stale leased delivery until its lease has expired. Purge first finalizes, in
two oldest-first 500-row `SKIP LOCKED` batches, stale deliveries whose leases
are not active and pending deliveries whose task no longer exists. Both use the
already-allowed `stale` terminal state and reason, after which the unchanged
retention stages can remove them. The wake helper now keeps cleanup outside a
nested exception block, so a synchronous Vault-query or `net.http_post` enqueue
exception cannot roll back maintenance that already completed. The migration's
final proof compares every event/task foreign key to the deletion inventory in
both directions by constraint and table identity, rather than accepting a
matching count alone.

The corrective function-body differences are deliberately narrow:

| Function | Applied definition | Corrective definition | Behavior difference |
| --- | --- | --- | --- |
| `claim_email_deliveries(integer)` | Finalizes every pending or leased row past `stale_at`. | Finalizes a past-`stale_at` pending row, or a leased row only when both its lease and `stale_at` have expired. | An active lease remains available to its current worker for acknowledgement. |
| `purge_email_delivery_history(timestamptz)` | Begins with the three retention deletes. | Runs the two bounded stale/orphan finalization stages, then the same three retention deletes. | Stale and task-orphaned pending work cannot keep an otherwise idle wake alive; active leases remain untouched. |
| `request_email_kick_if_due()` | Its function-level exception handler also rolled back earlier purge work when a Vault query or `net.http_post` enqueue raised synchronously. | Leaves the session check, purge, due check, and allowance check in place, then contains Vault reads, the `net.http_post` enqueue, kick-state success update, and the existing protected error counter in an inner exception block. | A synchronous Vault-query or enqueue exception returns `false` and attempts to increment the safe error count without undoing completed retention cleanup. No-work and allowance-spent paths are unchanged. |

All other statements in the three function bodies are identical to migration
88; the corrective migration reissues the same owners, revokes, and grant.

No Activity Log email, backup, CSV generation, or attachment is part of E1.
`src/lib/email/resend-sender.ts` accepts optional generic byte attachments so a
later approved batch can add that feature without changing providers.

## Reused P1 decisions

- Database-owned outbox, app-owned delivery.
- Public anon key plus a separately hashed and rotatable capability; no
  service-role exception.
- Constant-body wake route authenticated by a separate wake secret.
- Two-minute leases, bounded retry, `SKIP LOCKED`, aggregate-only run history,
  and bounded cleanup.
- Sender configuration is validated before any claim; content is revalidated
  once more immediately before each provider call.
- Queue/enqueue exceptions cannot roll back the bell row or push work.

Email differs where the provider requires it: one queue row per notification,
recipient email is resolved only during send preparation, Resend receives the queue id
as `Idempotency-Key`, and database attempt reservations enforce the shared
account allowance.

## Fixed limits

- Per run: 10.
- Attempts: 5, with 5-minute, 15-minute, 1-hour, then 4-hour delays.
- Stale: 24 hours after the notification.
- Dev daily allowance: 10.
- Prod daily allowance: 70.
- Assignments sort before reminders.
- Terminal queue retention: 7 days; attempt-ledger retention: 48 hours;
  aggregate run history: 30 days. Cleanup includes abandoned unfinished runs,
  is oldest-first, and is capped at 500 rows per table. The minute wake also
  runs cleanup when no delivery is due.

The assumed shared Resend Free limits are 100/day and 3,000/month, including
Supabase Auth. E1 therefore reserves at most 80 app-owned attempts per day and
2,480 in a 31-day month across Dev and Prod. Provider quota responses are still
possible when Auth uses the remaining allowance and are retried within the
same bounds. Each database enforces both its Manila business-day allowance and
the same allowance over a rolling 24-hour window, preventing a midnight reset
from producing a double burst. Attempt reservations survive queue or
notification deletion until that accounting window has safely expired.

`request_email_kick_if_due()` returns `false` before reading Vault or calling
`net.http_post` when no pending row or expired lease is due, or when either the
configured Manila-business-day allowance or rolling 24-hour allowance is
already spent. Its cleanup call occurs before those no-wake returns.
Claims record at most one aggregate `allowance reached` run row per hour, so a
one-minute cron cannot grow run history by 1,440 rows per exhausted day.

`net.http_post` only enqueues an asynchronous `pg_net` request. A connection or
HTTP failure after that enqueue does not raise inside
`request_email_kick_if_due()` and can therefore leave
`ceit_connect_private.email_kick_state.error_count` unchanged. Operators must
verify the most recently enqueued wake through its `last_request_id`, not infer
delivery from the function's `true` result or the error counter alone.

## Environment variables

All are server-only except the already-public Supabase URL/anon key:

- `RESEND_API_KEY`
- `EMAIL_FROM` — `CEIT Connect <no-reply@ceitconnect.site>`
- `EMAIL_SITE_URL` — production must be HTTPS; HTTP is accepted only for
  localhost outside production.
- `EMAIL_DB_CAPABILITY`
- `EMAIL_WAKE_SECRET`

Never paste values into source, documentation, browser code, logs, or a URL.
Dev and Prod use different capability and wake secrets. They may share the
owner-approved Resend account/key and verified `ceitconnect.site` domain.

## Dev owner steps

1. Review both tracked E1 migrations and both rollback-safe test pastes. The
   first migration is already applied on Dev; do not edit or reapply it.
2. From the repository terminal, target the Dev Supabase project using the
   owner's established project selection. Run a database-push dry run and
   confirm it lists only
   `20261126120000_email_queue_drop_task_fk.sql`. Then run exactly:

   ```text
   npx supabase db push
   ```

   Never apply the migration through Dashboard or SQL Editor.
3. Run the updated 31-check catalog and 34-check behavior pastes in the Dev SQL
   Editor. Both intentionally roll back.
4. Run `node scripts/generate-email-secrets.mjs` locally. Save its raw
   capability and wake secret in the password manager. Clear the terminal.
5. In Dev SQL Editor, run only the generated capability-hash call and:

   ```sql
   select public.configure_email_daily_allowance(10);
   ```

6. Add the five E1 variables to `.env.local`, using
   `EMAIL_SITE_URL=http://localhost:3000`, then restart the dev server.
7. Dev has no cron and no email Vault values. Manually POST `{}` to
   `http://localhost:3000/api/email/wake` with the secret in the
   `x-ceit-email-wake-secret` header using the same hidden-input practice as
   P1. Expect only `202 {"accepted":true}`.
8. In Resend's Dev delivery/request detail, verify the request uses the queue
   row UUID as `Idempotency-Key`. Exercise a retry with the same row and confirm
   Resend does not create a duplicate email. Also verify a concurrent-
   idempotency 409 and a 409 whose body cannot be read are retried, while a
   readable invalid-idempotency 409 is terminal. Other unreadable 4xx responses
   remain terminal.
9. Verify confidential copy contains no title/task URL, the footer links to
   `/settings`, preference-off suppresses pending work, assignments precede
   reminders, and the Dev allowance stops at ten reservations.

## Prod owner steps — fixed order

1. Run `node scripts/generate-email-secrets.mjs` again specifically for Prod.
   Save this new raw capability, wake secret, and generated capability-hash SQL
   together in the password manager. They must be separate from the Dev values
   and Dev capability hash; do not copy or rotate the Dev configuration.
2. In Vercel Production variables, add `RESEND_API_KEY`, `EMAIL_FROM`, the HTTPS
   `EMAIL_SITE_URL`, the newly generated Prod `EMAIL_DB_CAPABILITY`, and the
   matching newly generated Prod `EMAIL_WAKE_SECRET`. Scope these values to
   Production only; do not use them for Preview, Development, or `.env.local`.
3. Redeploy the app and wait until Vercel reports Ready. Before the migration,
   Settings must show the safe unavailable message and `/api/email/wake` must
   return only the generic 500 for a correct wake secret.
4. From the repository terminal, target Prod using the owner's established
   project selection. Run a database-push dry run and confirm it lists both
   `20261125120000_important_email_notifications.sql` and
   `20261126120000_email_queue_drop_task_fk.sql`, in that order. Apply both
   together with one command:

   ```text
   npx supabase db push
   ```

   Never apply the migration through Dashboard or SQL Editor.
5. In Prod SQL Editor, paste only the capability-hash call emitted by that same
   Prod script run. Its raw capability must exactly match the Production-only
   `EMAIL_DB_CAPABILITY`. Then run:

   ```sql
   select public.configure_email_daily_allowance(70);
   ```

6. In Supabase Dashboard Vault, create `email_kick_url` with the deployed
   `/api/email/wake` URL and `email_wake_secret` with the matching Prod wake
   secret from the Prod script run. Do not put either value in a query string,
   and do not reuse the Dev wake secret.
7. Manually wake once and verify one controlled delivery, generic response,
   safe logs, and aggregate run history. After `pg_net` has processed the
   request, run this read-only SQL Editor paste. It resolves the stored
   `last_request_id` internally and returns only the response status and safe
   error message—no URL, headers, body, or secret:

   ```sql
   select response.status_code as status,
          response.error_msg as error_message
   from ceit_connect_private.email_kick_state as kick_state
   left join net._http_response as response
     on response.id = kick_state.last_request_id
   where kick_state.singleton;
   ```

   A null response means the request is still pending, expired from `pg_net`
   history, or was not enqueued. A non-success status or non-null error message
   means the asynchronous wake did not complete successfully; it may not have
   incremented `email_kick_state.error_count`.
8. Last, in Supabase Dashboard → Integrations → Cron, create one job:

   - Name: `important-email-delivery`
   - Schedule: `* * * * *`
   - Command: `select ceit_connect_private.request_email_kick_if_due();`

9. Verify exactly one active job with that name, schedule, and command. A run
   with no due work or a spent daily allowance must return false and create no
   HTTP request.

## Email copy boundary

Non-confidential mail includes only the task title and direct task link.
Confidential mail is generic and links only to `/workspace`. Every email says
that replies are not monitored and links to generic `/settings` with the text
that the user can turn the emails off there. No email contains a description,
event name, person name, comment, exact deadline/call time, raw SQL/provider
error, secret, or timezone label.

The send-preparation RPC is the documented confidentiality timing boundary: it
does not reuse content returned by the earlier lease claim. The worker must
prepare each delivery immediately before the bounded Resend request and must
not send if preparation fails, the current recipient is no longer eligible, or
the short database send guard cannot cover the complete provider timeout.

## Catalog follow-up recommendation

No additional type is enabled. `heads_up` is the strongest future candidate;
`leave_approved` and `leave_denied` are reasonable decision emails.
`backup_request` may be operationally important but risks leadership volume.
All require separate owner approval.

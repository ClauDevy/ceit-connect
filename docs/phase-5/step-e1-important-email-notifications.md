# Phase 5 E1 — important email notifications

## Scope

E1 emails only `assignment`, `task_due_soon`, and `live_operation_prep`.
Email is an independent best-effort channel behind the existing bell row and
push enqueue. The database outbox contains no address or task content. The
capability-authenticated claim resolves only a confirmed Auth email matching
the active, non-anonymized profile. Confidential claims return no title and
only `/workspace`; non-confidential claims return the title and exact task
path.

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
- Sender configuration is validated before any claim.
- Queue/enqueue exceptions cannot roll back the bell row or push work.

Email differs where the provider requires it: one queue row per notification,
recipient email is resolved only while claiming, Resend receives the queue id
as `Idempotency-Key`, and database attempt reservations enforce the shared
account allowance.

## Fixed limits

- Per run: 10.
- Attempts: 5, with 5-minute, 15-minute, 1-hour, then 4-hour delays.
- Stale: 24 hours after the notification.
- Dev daily allowance: 10.
- Prod daily allowance: 70.
- Assignments sort before reminders.
- Terminal queue retention: 7 days; aggregate run history: 30 days; cleanup
  is oldest-first and capped at 500 rows per table.

The assumed shared Resend Free limits are 100/day and 3,000/month, including
Supabase Auth. E1 therefore reserves at most 80 app-owned attempts per day and
2,480 in a 31-day month across Dev and Prod. Provider quota responses are still
possible when Auth uses the remaining allowance and are retried within the
same bounds.

`request_email_kick_if_due()` returns `false` before reading Vault or calling
`net.http_post` when no pending row or expired lease is due, or when the
configured allowance for the current Manila business day is already spent.
Claims record at most one aggregate `allowance reached` run row per hour, so a
one-minute cron cannot grow run history by 1,440 rows per exhausted day.

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

1. Review the full tracked migration and both rollback-safe test pastes.
2. From the repository terminal, target the Dev Supabase project using the
   owner's established project selection, then run exactly:

   ```text
   npx supabase db push
   ```

   Never apply the migration through Dashboard or SQL Editor.
3. Run the catalog and behavior pastes in the Dev SQL Editor. Both intentionally
   roll back.
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
   Resend does not create a duplicate email.
9. Verify confidential copy contains no title/task URL, the footer links to
   `/settings`, preference-off suppresses pending work, assignments precede
   reminders, and the Dev allowance stops at ten reservations.

## Prod owner steps — fixed order

1. In Vercel Production variables, add `RESEND_API_KEY`, `EMAIL_FROM`, the HTTPS
   `EMAIL_SITE_URL`, the Prod-only `EMAIL_DB_CAPABILITY`, and Prod-only
   `EMAIL_WAKE_SECRET`.
2. Redeploy the app and wait until Vercel reports Ready. Before the migration,
   Settings must show the safe unavailable message and `/api/email/wake` must
   return only the generic 500 for a correct wake secret.
3. From the repository terminal, target Prod using the owner's established
   project selection and run exactly:

   ```text
   npx supabase db push
   ```

   Never apply the migration through Dashboard or SQL Editor.
4. In Prod SQL Editor, run only the Prod capability-hash call and:

   ```sql
   select public.configure_email_daily_allowance(70);
   ```

5. In Supabase Dashboard Vault, create `email_kick_url` with the deployed
   `/api/email/wake` URL and `email_wake_secret` with the matching Prod wake
   secret. Do not put either value in a query string.
6. Manually wake once and verify one controlled delivery, generic response,
   safe logs, and aggregate run history.
7. Last, in Supabase Dashboard → Integrations → Cron, create one job:

   - Name: `important-email-delivery`
   - Schedule: `* * * * *`
   - Command: `select ceit_connect_private.request_email_kick_if_due();`

8. Verify exactly one active job with that name, schedule, and command. A run
   with no due work or a spent daily allowance must return false and create no
   HTTP request.

## Email copy boundary

Non-confidential mail includes only the task title and direct task link.
Confidential mail is generic and links only to `/workspace`. Every email says
that replies are not monitored and links to generic `/settings` with the text
that the user can turn the emails off there. No email contains a description,
event name, person name, comment, exact deadline/call time, raw SQL/provider
error, secret, or timezone label.

## Catalog follow-up recommendation

No additional type is enabled. `heads_up` is the strongest future candidate;
`leave_approved` and `leave_denied` are reasonable decision emails.
`backup_request` may be operationally important but risks leadership volume.
All require separate owner approval.

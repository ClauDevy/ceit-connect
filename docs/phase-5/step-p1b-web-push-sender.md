# Phase 5 P1b — web-push sender and browser application

**Status:** Implemented and locally verified; owner browser review and rollout pending | **Branch:** `feature/web-push` | **Reasoning:** High

## Goal and boundary

P1b is the application half of web push. It adds the isolated wake route,
anon-key/capability sender, push-only service worker, per-device Settings
control, best-effort current-device sign-out cleanup, local setup helper, and
application tests. P1a is already live on Dev and Prod. P1b adds no migration,
policy, function, table, service-role exception, offline cache, or public
sign-up path.

Push payloads contain exactly `title`, `body`, and `tag`. Title and body are the
generic strings returned by `claim_push_deliveries`; tag is that row's opaque
delivery UUID. No name, task title, event name, comment, task ID, endpoint, key,
or navigation address is included. The worker ignores every payload address,
focuses an existing same-origin window without navigating it, and opens fixed
`/` only when no same-origin window exists or focusing fails.

## Sender security and timing

`POST /api/push/wake` is outside the auth proxy, ignores its body, reads no
cookies, and accepts only `x-ceit-wake-secret`. Missing and wrong values receive
the same generic `401`. The route validates the VAPID subject, public key, and
private key with `web-push` before it schedules background work. Missing or
invalid VAPID configuration returns a generic server error and claims nothing,
so queued rows remain pending.

The sender uses only the environment's public Supabase URL and anon key plus
the separate `PUSH_DB_CAPABILITY` header. It cannot use the service-role key.
It re-validates HTTPS endpoint hosts and decoded key lengths immediately before
each send. A bad endpoint, a p256dh value that is not exactly 65 decoded bytes,
or an auth value that is not exactly 16 decoded bytes is acknowledged as
`permanent` with status 400.

The Node route has `maxDuration = 60`; Next `after()` uses Vercel's `waitUntil`
support on Hobby and returns the `202` response before delivery work. The loop
budget is 45 seconds. The arithmetic is deliberately conservative:

- claim limit: 20;
- concurrency: 10, so one claim is at most two waves;
- Web Push timeout: 8 seconds per wave;
- database RPC timeout: 1 second per claim, acknowledgement, or finish request,
  through full response-body consumption;
- wave admission reserve: 8,000 ms send timeout + 1,000 ms acknowledgement
  timeout = 9,000 ms; acknowledgements within a wave run concurrently;
- claim admission reserve: 9,000 ms wave reserve + 2,000 ms claim/finish margin
  (one separately bounded second each) = 11,000 ms, so a new claim is never
  taken without room to start its first wave;
- worst planned send time for one full claim: 2 × 8,000 ms = 16,000 ms, inside
  the 45,000 ms loop budget;
- remaining time is checked before every claim and every wave. A claim never
  starts below 11,000 ms and a wave never starts below 9,000 ms. Any unsent leased rows are not
  acknowledged or changed; their two-minute database leases expire normally.

Transport metadata is defined once in the sender: TTL is 3,600 seconds and
urgency is `normal`. Redirects are never followed. `2xx` is success; 404/410 is
gone; 408/425/429/5xx is transient; other 4xx is permanent with its real
status. Genuine network/timeout errors and unexpected library errors are
transient with no status so the bounded database retry schedule decides their
fate. Logs contain aggregate counts only.

## Install the pinned library

The owner already installed these exact versions in Git Bash:

```bash
npm install --save-exact web-push@3.6.7 && npm install --save-dev --save-exact @types/web-push@3.6.4
```

`web-push` provides Node Web Push encryption and VAPID signing. Its type package
provides matching TypeScript declarations. Do not replace either with an
animation, service-worker, or offline package.

## Generate one environment's secrets locally

Do this separately for Dev and Prod. The helper prints once, stores nothing,
and sends nothing.

1. In VS Code, open `scripts/generate-push-secrets.mjs` and confirm it imports
   only `node:crypto`.
2. Open the VS Code terminal in this repository.
3. Run `node scripts/generate-push-secrets.mjs`.
4. Immediately copy the capability, wake secret, salt, hash, and SQL call into
   the correct environment's password-manager entry.
5. Clear the terminal after saving them. Never paste the raw capability into
   Supabase, source, documentation, a URL, or a `NEXT_PUBLIC_*` variable.
6. In that environment's Supabase SQL Editor, paste only the printed
   `configure_push_sender_credential_hash('current', 1, ...)` call containing
   the salt and hash, review the environment selector, and click **Run**.

Dev and Prod must use different capabilities, wake secrets, salts, and hashes.

## Generate and protect VAPID keys

1. In the repository terminal, run `npx web-push generate-vapid-keys --json`.
2. Store the public/private pair in the password manager under the intended
   environment.
3. Generate a separate pair for the other environment.
4. The public key must always belong to the matching private key.
5. **Never regenerate or replace an environment's VAPID keys after anyone has
   subscribed.** Existing browser subscriptions are bound to that public key;
   changing the pair would stop all of them from working until each person
   explicitly enabled notifications again.

## Environment variables

Configure Dev in `.env.local` and Prod in the Vercel Production environment.
After changing Vercel variables, redeploy; after changing `.env.local`, restart
the local development server. Do not configure a Dev preview wake deployment.

| Variable | Visibility | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Public | Bare URL of that environment's Supabase project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon key from that same project. |
| `NEXT_PUBLIC_PUSH_VAPID_PUBLIC_KEY` | Public | Public half of that environment's VAPID pair. |
| `PUSH_VAPID_PRIVATE_KEY` | Server only | Matching private half; never expose it to the browser. |
| `PUSH_VAPID_SUBJECT` | Server only | A monitored `mailto:` contact for VAPID. |
| `PUSH_DB_CAPABILITY` | Server only | Raw capability matching that environment's stored salted hash. |
| `PUSH_WAKE_SECRET` | Server only | Dev manual-wake secret locally; in Prod, the secret matching Vault `push_wake_secret`. |

## Supabase Vault setup

Dev deliberately skips both Vault values: there is no reachable Dev sender URL,
localhost cannot be called by hosted Supabase, and Vercel preview protection
would block a database wake. Dev uses only the manual local wake below.

For Prod only:

1. Open the intended Supabase project and confirm its project name.
2. Find **Vault** in the Supabase dashboard menu; its location can vary with
   dashboard updates.
3. Create or update `push_kick_url` with the Production URL ending in
   `/api/push/wake`.
4. Create or update `push_wake_secret` with that environment's wake secret.
5. Put the same raw value in that deployment's server-only
   `PUSH_WAKE_SECRET`.
6. Keep both values Prod-only; do not create Dev copies.

## Manual local Dev wake

Hosted Dev cannot call a localhost URL. To test the local route without placing
the secret in a URL or shell history:

1. Start the app locally after the owner has configured local variables.
2. Open Git Bash in the repository.
3. Run `read -s PUSH_WAKE_VALUE` and paste the Dev wake secret when prompted,
   then press Enter. The secret is not displayed.
4. Run:

```bash
curl --request POST http://localhost:3000/api/push/wake \
  --header "x-ceit-wake-secret: $PUSH_WAKE_VALUE" \
  --header "content-type: application/json" \
  --data '{}'
```

5. Expect only `{"accepted":true}` with status 202 and no redirect. This also
   proves `/api/push/wake` bypasses the auth proxy. Delivery details must never
   appear in the response or terminal log.
6. Run `unset PUSH_WAKE_VALUE` immediately afterward.

## Prod-only schedules

Dev gets neither job. Only after the P1b Dev gate passes, use the Prod SQL
Editor. First remove an old fallback with the same name:

```sql
select cron.unschedule(jobid)
from cron.job
where jobname = 'p1-push-delivery-fallback';
```

Create the 15-second due-work fallback exactly:

```sql
select cron.schedule(
  'p1-push-delivery-fallback',
  '15 seconds',
  $$select ceit_connect_private.request_push_kick_if_due();$$
);
```

Verify its exact schedule and command:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'p1-push-delivery-fallback';
```

Create the separate cleanup at 12:25 AM Philippine time (16:25 UTC):

```sql
select cron.schedule(
  'p1-push-delivery-cleanup',
  '25 16 * * *',
  $$select * from public.run_push_delivery_cleanup();$$
);
```

## Manual browser gate

Android and desktop browsers can test against localhost and the Dev Supabase
project. iPhone web push requires the installed HTTPS app and can be tested only
on Prod after this branch is merged and deployed.

### Android

1. Sign in, open Settings, and tap **Enable notifications**.
2. Confirm the permission prompt appears only after the tap.
3. On localhost against Dev, trigger one notification and confirm generic copy appears.
4. Tap it and confirm an existing CEIT Connect window is only focused without
   changing its page; with no same-origin window, confirm the app opens at `/`.
5. Turn notifications off and confirm the device changes to Off.

### iPhone installed app

1. In Safari before installation, confirm Settings shows the Home Screen hint
   and no Enable button.
2. Add the app to the Home Screen and open that installed icon.
3. Sign in, tap Enable, and allow the synchronous permission prompt.
4. After merge on Prod, trigger a notification, including while the app is closed, and confirm
   a visible generic notification appears.
5. Tap it and confirm an existing CEIT Connect window is only focused without
   changing its page; with no same-origin window, confirm the installed app
   opens at `/`.

### Desktop

1. On localhost against Dev, enable from Settings and confirm the browser prompt follows the tap.
2. Confirm On survives refresh only while both the browser subscription and
   saved UUID still match the safe database device list.
3. Remove the device and confirm the database removal occurs before browser
   unsubscribe.
4. Sign out and confirm navigation is not delayed longer than about three
   seconds even if cleanup fails.

## Read-only Prod delivery proof

After a real Prod notification, open the Prod SQL Editor and run this read-only
paste. It exposes only timestamps and aggregate counts—no users, notifications,
deliveries, endpoints, keys, or payloads:

```sql
select started_at,
       finished_at,
       claimed_count,
       delivered_count,
       retry_scheduled_count,
       terminal_count,
       expired_subscription_count,
       unacknowledged_count
from ceit_connect_private.push_delivery_runs
order by started_at desc
limit 10;
```

The newest finished row should show at least one claimed delivery and the
expected delivered/retry/terminal aggregate. Do not treat a retry as a delivery.

## Security gate

- Missing and wrong wake headers both return generic 401 and claim nothing.
- Missing/invalid VAPID configuration returns a generic server error and claims
  nothing.
- The route accepts no recipient, title, body, endpoint, or delivery input.
- No sender file imports the service-role client or service-role key.
- Lookalike, HTTP, userinfo, explicit-port, fragment, and redirect endpoints
  are rejected or not followed.
- Bad p256dh/auth lengths become permanent 400 without a network request.
- Simulated timeout/network/library errors become transient.
- Payload inspection shows only title, body, and delivery-ID tag.
- Worker source has no fetch handler, Cache API, offline behavior, or
  payload-controlled navigation.
- Sign-out best-effort attempts removal of only the current user's locally
  remembered device UUID and best-effort clearing of that local UUID. No
  cleanup error or timeout blocks the authoritative session sign-out.
- Logs and responses reveal no endpoint, key, secret, payload, person, task,
  notification, or delivery identifier.

## Local automated result

- `npm.cmd run test`: 1,258/1,258 tests pass across 120 files, including 70
  focused P1b tests.
- `npm.cmd run lint`: passes with 0 errors and the unrelated existing
  `src/components/ui/mascot.tsx` unused-`INK` warning.
- `git diff --check`: passes; Git prints only its Windows LF-to-CRLF advisory
  for `next.config.ts`.
- `npx.cmd tsc --noEmit`: reaches only the three documented missing
  Next-generated `PageProps`/`LayoutProps` globals while generated types are
  absent; the owner-required no-build gate does not regenerate them.

## Unrelated follow-up

P1a's claimed `out_target_path` is the stale `/notifications` value, but this
application has no authenticated `/notifications` page. P1b deliberately
ignores it: a click only focuses an existing same-origin window without
navigating it, and opens `/` when no such window exists or focusing fails.
Revisit the database target only with the future
jump-to-comment/navigation design; do not invent a page or migration in P1b.

`pushsubscriptionchange` is also deferred. If a browser rotates its subscription
automatically, that device silently stops receiving pushes until the person
returns to Settings and explicitly enables notifications again.

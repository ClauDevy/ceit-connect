# CEIT Connect — Gotchas (hard-won lessons)

Every item here cost real debugging time. Read the relevant section before touching auth, email, Supabase settings, or deployment.

## 1. Settings that do NOT travel with a code deploy or a migration

When a new environment (e.g. Prod) is set up, each of these must be configured **by hand in that project's dashboard**, matching Dev:

1. Auth → Sign In / Providers → **Google**: enable, paste the Client ID/Secret. Each Supabase project has its **own callback URL**; add it to the Google Cloud OAuth client's *Authorized redirect URIs*.
2. Auth → **URL Configuration**: Site URL = the real deployed address; Redirect URLs must include `<site>/auth/callback`.
3. Auth → Emails → **SMTP Settings** (custom SMTP).
4. Auth → Emails → **Templates → Reset Password**: body must show `{{ .Token }}` as plain text (the typed-code flow).
5. **Storage buckets**: `avatars` is still created by hand; the Step 7 banner migration creates and configures `banners` itself so Dev and Prod stay identical.
6. **Vercel env vars** (+ a fresh redeploy; new variables never apply to an already-built deployment). Location: Project Settings → Environments → *Production* → Add Environment Variable.
7. The **first Admin account**, created manually (see `docs/DATABASE.md`).

| Symptom | Cause |
|---|---|
| `Unsupported provider: provider is not enabled` | Google not enabled on that project |
| Google login ends at "localhost refused to connect" on the live site | Prod Site URL / Redirect URLs still `localhost` |
| Emails from Supabase's own address, or old link-style reset email | SMTP / template only configured on Dev |
| Nobody can log in on a fresh project | No Admin exists yet (chicken-and-egg) |

## 2. Environment variables
- `NEXT_PUBLIC_SUPABASE_URL` must be the **bare** project URL (`https://<ref>.supabase.co`). A trailing `/rest/v1/` sends sign-in requests to the wrong endpoint (`PGRST125 Invalid path`) while the UI claims "email isn't recognized".
- `.env.local` changes need a dev-server restart. Vercel changes need a redeploy.
- Google's consent-screen name comes from Google Cloud → **Branding**, not the OAuth client's internal "Name" field.

## 3. Email
- Supabase's built-in mailer is a sandbox (~2 emails/hour for the whole project): `over_email_send_rate_limit`. Custom SMTP raises it to 30/hour.
- Email security scanners (notably Google Workspace / university accounts) **pre-visit links** and burn single-use tokens, producing `otp_expired` before the person clicks. That is why password reset uses a **typed 6-digit code**, not a link. For magic links, "copy link address" and paste it is only a partial workaround.
- Gmail SMTP needs 2-Step Verification + an **App Password** (shown once; the same one works for Dev and Prod). Host `smtp.gmail.com`, port **587**. (Resend uses 465 and needs a verified domain — a `vercel.app` address can't be verified.)
- The login page deliberately shows one generic error; the real cause (rate limit, bad URL) is only visible in the browser Network tab.
- No system can verify a mailbox exists before inviting it: a mistyped address still creates an "Active" account that can never be used. Deactivate it; never delete.

## 4. Next.js 16 / React
- `middleware.ts` was renamed **`proxy.ts`**. It only refreshes the Supabase session; never gate pages there (known bypass class). Gate in pages, layouts, and route handlers.
- **Layouts and pages render in parallel** — a layout `redirect()` does not stop the page below. Use `requireUser()`; never `user!`.
- A route exists only if the file is literally named `page.tsx` / `route.ts` at that path (a misnamed `route.ts` = silent 404).
- `src/app/layout.tsx` must exist and render `<html>` and `<body>`, or every page errors with "Missing html and body tags".
- `redirect()` inside a Route Handler sends a 307, which keeps the POST method. After a POST use `NextResponse.redirect(url, 303)`.
- React Strict Mode runs effects **twice in dev**: a client `useEffect` that exchanges a one-time code will burn it on the first run. Guard with `useRef` or do the exchange server-side.
- Recovery/OTP codes are single-use. Keep "verify code" and "save new password" as **two separate steps** so a failed save can be retried without a new code.
- The back button can restore a frozen page from the browser's back-forward cache after sign-out. `BfcacheGuard` forces a reload on persisted `pageshow`. **Chrome DevTools being open disables bfcache**, which makes broken fixes look like they work — test with DevTools closed.
- When pasting a patch into a big file (e.g. `(dashboard)/layout.tsx`), replace the whole file; pasting a second copy causes "Cannot redeclare block-scoped variable".
- `AGENTS.md`'s Next.js block is re-added by `next dev`; leave it in.

## 5. Supabase CLI and migrations
- `db push` needs a linked project (`Cannot find project ref` → `npx supabase link --project-ref <ref>`). After pushing to Prod, **link back to Dev** so later work can't hit Prod by accident.
- `unexpected login role status 403 ... necessary privileges`: re-run `npx supabase login` with the account that owns the organization, check `npx supabase projects list` shows the right project linked, and if it persists, check `npx supabase db push --help` for a database-password option (e.g. `--password`) to bypass the temporary login role — verify the exact flag on your CLI version.
- Schema changes typed into the SQL Editor are not tracked. Convert them to a migration file, and if the change already exists on a remote, mark it applied: `npx supabase migration repair --status applied <timestamp>`.
- `db push` and `git push` are independent. Order: Dev DB → test → commit/PR → merge → Prod DB.
- Insert policies use `with check`; select/update/delete use `using`. Cast UUID literals with `::uuid`.
- A policy on `users` that queries `users` recurses forever — use `my_role()` / `my_committee_id()`.
- Order of operations matters: validate (e.g. email domain) **before** creating an account; update the database **before** deleting a Storage file; check the result of every follow-up write.
- Never `delete` a user "to clean up" because a profile lookup returned null — null also means a query error. Use `maybeSingle()` and check `error` first.

### SQL testing

- Compute expected values as the table owner before impersonating a role; impersonated roles can see only the rows allowed by RLS.
- Check catalog-exposed properties (`prosecdef`, `provolatile`, `proconfig`, grants) in `pg_proc`/`pg_catalog`; never infer them by text-matching `pg_get_functiondef()` output.

## 6. Workflow
- CodeRabbit (VSCode) found real bugs on every branch; run it before each PR and again after fixing.
- First push of a new branch: VSCode "Publish Branch" (or `git push --set-upstream origin <branch>`).
- Run `npm run build` before a PR; production builds catch type errors dev mode ignores.
- Unused packages `cn` and `p` in `package.json` are leftovers; remove them.

# Phase 5 I1 — Installable app basics

**Status:** Implemented locally; owner phone gate and rollout pending | **Branch:** `feature/installable-app` | **Reasoning:** Medium

## Goal and boundary

I1 gives CEIT Connect a standards-based web manifest, committed install icons,
theme-aware browser chrome, and plain Settings instructions for installing the
site. It changes no authentication, authorization, notification, database, or
offline behavior. The branch was created from updated `origin/main`:
`git log --oneline origin/main..HEAD` returned no commits before implementation.

I1 deliberately adds no service worker, offline cache, push notification,
background sync, SQL, migration, RLS, RPC, custom install button,
`beforeinstallprompt` handler, email, or Discord behavior. Offline caching is
out of scope because stale task, event, user, or notification content could
remain on a device after sign-out or deactivation.

## Repository baseline

Before I1 the repository had no web manifest, Apple touch icon, Apple web-app
tags, HTML theme-color tags, service worker, or install-prompt handler. Root
metadata contained only the CEIT Connect title and description.

The existing `src/app/icon.svg` and 16/32/48 `src/app/favicon.ico` were already
the application favicon. Other brand artwork remains under `public/brand/`.
`next.config.ts` has no application-defined response headers or CSP. The proxy
refreshes Supabase sessions and applies
`Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate` to
matched routes; it does not redirect users.

## Manifest and metadata

`src/app/manifest.ts` publishes `/manifest.webmanifest` with this contract:

- `id`, `start_url`, and `scope`: `/`
- `name` and `short_name`: `CEIT Connect`
- `display`: `standalone`
- `theme_color` and `background_color`: paper `#FFF8F0`
- no orientation lock
- 192 and 512 ordinary PNG icons plus a 512 maskable PNG icon

Root viewport metadata publishes paper `#FFF8F0` for light browser chrome and
ink `#1B140F` for dark browser chrome. Orange `#EC6608` remains an accent only.
Apple metadata uses the 180 px touch icon, app title `CEIT Connect`, standalone
capability, and the default status-bar style.

A manifest has one launch background here, not separate light and dark splash
backgrounds. A device launching in dark mode can therefore show a brief paper
splash before CEIT Connect applies its saved dark theme. The per-scheme HTML
theme-color tags still color supported browser chrome correctly.

## Static icon generation

`src/app/icon.svg` is the unchanged master. Its real full-bleed color is read
from its background rectangle (`#1B140F`); no color is duplicated in the
generation command. The source already places the shield within approximately
the central 68% of the square. Each generated PNG composites the source over
that exact color, removes alpha, and is saved as plain 8-bit RGB so rounded
source corners cannot leave a seam or transparency.

Sharp was already present locally through the existing Next.js installation.
Nothing was installed and no generator script was retained. This was the exact
successful one-time PowerShell command:

```powershell
node --% -e "const fs=require('node:fs');const path=require('node:path');const sharp=require('sharp');const source='src/app/icon.svg';const svg=fs.readFileSync(source,'utf8');const match=svg.match(/<rect[^>]*fill=\"(#[0-9A-Fa-f]{6})\"/);if(!match)throw new Error('Icon background fill not found');const background=match[1];const outputs=[['icon-192.png',192],['icon-512.png',512],['maskable-icon-512.png',512],['apple-touch-icon.png',180]];fs.mkdirSync('public/icons',{recursive:true});Promise.all(outputs.map(([name,size])=>sharp(Buffer.from(svg)).resize(size,size).flatten({background}).removeAlpha().png().toFile(path.join('public/icons',name)))).then(()=>console.log('Generated '+outputs.length+' RGB icons with '+background+' full-bleed background from '+source));"
```

An earlier invocation was rejected by PowerShell quoting before JavaScript ran;
it created no files. The command above is the only invocation that generated
assets.

Committed outputs:

- `public/icons/icon-192.png`
- `public/icons/icon-512.png`
- `public/icons/maskable-icon-512.png`
- `public/icons/apple-touch-icon.png`

If the approved source ever proves unsuitable, work stops until the owner
provides the vector. Artwork must never be traced or substituted.

## Public reachability and existing redirects

The proxy matcher now excludes `manifest.webmanifest` explicitly. Its existing
image-extension rule excludes the PNG icons. These assets are reachable without
a session, do not run session refresh, do not inherit the protected-page
no-store header, and cannot be redirected to `/login` by the proxy.

Opening the installed icon starts at `/`; the existing root redirect sends the
user to `/home`, and the existing page guard sends a signed-out user to
`/login`. Sign-out still posts to `/auth/signout` and redirects with 303. The
dashboard layout still signs out an inactive profile and redirects to
`/login?error=deactivated`. Invite links continue through `/auth/callback`,
whose admission and safe internal-next checks are unchanged. Password recovery
remains the typed-code login flow and `/api/complete-reset`.

Standalone mode changes browser presentation, not these routes or security
checks. It starts at `/` rather than reopening the last browser page. On iPhone,
the installed app keeps its own sign-in; invite and reset links opened from Mail
start in Safari, and Safari's session does not silently transfer to the
installed app. External link capture otherwise remains browser- and OS-owned.

## Settings help

Settings keeps its established `max-w-4xl`, two-column `SettingsSection`
pattern and adds an instruction-only “Install the app” card. The server and
first client render show a neutral checking message. After mount the client
checks both `(display-mode: standalone)` and iOS `navigator.standalone`, and it
listens for display-mode changes.

Installed mode shows “You're using the installed app.” Browser mode shows
iPhone instructions first (Safari, Share, Add to Home Screen), then Android
instructions (Chrome menu, Install app, or Add to Home screen if that label is
shown). The card has semantic headings and ordered lists and no custom install
control.

## Automated coverage and manual gate

`src/lib/installable-app-contract.test.ts` covers the manifest values; RGB PNG
headers, dimensions, full-bleed corners, safe-zone bounds, and unchanged source
hash; Apple and per-scheme metadata; matcher/no-store preservation; and the
Settings source contract. The repository has no jsdom or equivalent browser
DOM environment, so the card behavior is intentionally covered by source-
contract tests. The real phone checklist below is the acceptance gate.

The full test run passes all 1,159 assertions across 110 files. Lint has zero
errors and only the pre-existing unused-`INK` warning in `mascot.tsx`.
`git diff --check` passes with only the working-tree CRLF notice for
`src/proxy.ts`. Direct `tsc --noEmit` reaches only the three already-documented
missing Next-generated `PageProps`/`LayoutProps` globals while `.next` is
absent; I1 introduces no TypeScript error. No build was run.

### iPhone

- In Safari, use Share → Add to Home Screen; confirm name and icon.
- Open from the icon; confirm standalone presentation and `/` → `/home`.
- Sign in, sign out, and confirm the app's sign-in is separate from Safari.
- Confirm a deactivated account reaches the established deactivated login error.
- Open and complete a real invite from Mail/Safari through `/auth/callback`.
- Exercise the reset email/code flow from Safari and the login page.
- Check the paper light theme, ink dark browser chrome, and documented paper
  splash in dark mode.
- Confirm Settings says “You're using the installed app.”
- Open the notification bell, load rows, mark one/all read, and confirm updates.

### Android

- In Chrome, use Install app, or Add to Home screen if that label is shown.
- If neither option exists without a service worker, report the result; do not
  add a service worker.
- Confirm the launcher name, maskable crop, standalone presentation, and
  `/` → `/home`.
- Repeat sign-in, sign-out, deactivation, invite/callback, and reset checks.
- Check light and dark browser colors and the installed-state Settings message.
- Confirm the notification bell works in installed mode.

Also confirm in ordinary iPhone and Android browser tabs that Settings shows the
instructions and existing authentication behavior remains unchanged.

## Unrelated issues observed, not fixed

- Settings ignores its profile-query error and falls back to empty values.
- The dashboard layout ignores its profile-query error and inactive sign-out
  result.
- `/api/set-password` and `/api/complete-reset` have the already-tracked missing
  independent active-profile check around service-role use.
- The repository defines no global CSP/security-header policy.

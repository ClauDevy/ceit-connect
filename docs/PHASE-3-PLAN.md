# Phase 3 — Event engine: build plan

Goal: replace the mock-data HTML prototypes with real Supabase-backed pages, **one step at a time**. Each step: own branch → build → manual test → `npm run build` → CodeRabbit → PR. Do not start the next step until the owner confirms the current one works. Design source for each page is the matching file in `docs/prototypes/` (the owner adds the rest); match its layout and behavior using the shared components in `src/components/ui` and `src/components/shared`.

Security reminders that apply to every step: RLS is the real enforcement (add/adjust policies via new migration files); pages call `requireUser()`; Admin/Co-Admin-only pages also check the role server-side; never trust client-supplied ids or URLs.

## Step 1 — Create Event, Fundamentals tab ✅ done
`/events/new`: name, dates, description, Save Draft / Launch Event, real insert. `events_insert` requires `created_by = auth.uid()`.

## Step 2 — Home shows real events
- Replace Home's placeholder with a real list/timeline of events (prototype: `docs/prototypes/ceit-connect-home.html`).
- Draft events render with a **dashed border + grey "Draft" badge** and are visible **only to their creator** (already enforced by `events_select`; verify, don't re-implement in the UI).
- "+ New Event" button, visible to Admin and Co-Admin only, linking to `/events/new`; add the route to navigation if appropriate.
- After saving on `/events/new`, redirect to Home so the new event is visible.
- Empty state uses the tiger mascot when there are no events.
- **Test:** create one Draft and one Active event → both show for the creator; sign in as a different user → the Draft is invisible (list **and** direct URL); a Member has no "+ New Event" button.

## Step 3 — Task Setup (the Tasks tab on Create Event)
- Add phases and tasks (title, committee, type Deliverable/LiveOperation, due date, priority default Medium, description). Assignees are optional — unassigned tasks land in the Backlog.
- Saving an event with tasks must be **atomic** (all-or-nothing). Suggested: a Postgres function (`rpc`) that inserts the event and its tasks in one transaction, running with the caller's privileges so RLS still applies. Otherwise insert the event, then the tasks, and clean up on failure.
- A Co-Admin may only create tasks in their own committee (RLS already enforces; also limit the dropdown).
- Ask the owner whether the summary check "at least one task added" should return as a requirement for Launch.
- **Test:** launch an event with 3 tasks → 3 rows with the right `event_id` / `committee_id`; as a Co-Admin, try to create a task for another committee → rejected.

## Step 4 — Edit Event
- Load an existing event (and its tasks) into the same form; only the creator or an Admin may edit (`events_update`).
- Prototype: `docs/prototypes/ceit-connect-edit-event.html` (owner adds it).
- **Test:** edit name/dates → saved; a non-creator Co-Admin cannot edit someone else's event.

## Step 5 — Template Auto-Import
- "Start from Archive Template" lists Archived events; a Supabase SQL function duplicates the chosen event's tasks into the new event.
- Relative scheduling: `new_task_deadline = new_event_start + (old_task_deadline − old_event_start)`.
- Assignees are wiped; tasks route to the Backlog.
- **Test:** import into a future event → dates shift correctly, backlog populated, no assignees.

## Step 6 — Event Archives (read-only)
- `/archives` lists Archived events; an Admin action sets `status = 'Archived'`.
- Archived events are frozen: **enforce read-only in the database** (policy or trigger blocking updates to the event and its tasks), not only by hiding buttons. Historical comments and Drive links stay readable.
- **Test:** archive an event → dragging/editing/commenting is blocked even via a direct API call.

## Step 7 — Banner upload
- New public `banners` bucket (created by hand per environment; ~1.5 MB limit; JPEG/PNG/WebP) with storage policies in a **migration file**, mirroring the `avatars` bucket pattern.
- Crop 16:9, compress to 1–1.5 MB WebP client-side, upload, then save `banner_url` through a server route that computes/validates the expected URL itself (same pattern as `/api/update-avatar` — never accept a client-supplied URL).
- **Test:** a 4 MB photo is rejected/forced through crop; the banner shows on the event; the old file is replaced on re-upload.

## Step 8 — Google Drive preview helper
- Build `toPreviewUrl()` and a small `DrivePreview` component (see `docs/ARCHITECTURE.md` §1) with the plain-link fallback and "Preview unavailable" note. The task modal is a Phase 4 feature, so ship the component now with a tiny demo/test and wire it into the modal when that exists.
- **Test:** a valid share link renders an inline preview; plain text falls back to a link, never a broken iframe.

## Phase 3 gate (from the architecture doc)
Auto-import lands relative dates correctly and populates the backlog with no assignees; a valid Drive link previews and plain text falls back; a non-owner cannot see a Draft event even via direct URL.

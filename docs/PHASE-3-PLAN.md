# Phase 3 — Event engine: build plan

Goal: replace the mock-data HTML prototypes with real Supabase-backed pages, **one step at a time**. Each step: own branch → build → manual test → `npm run build` → CodeRabbit → PR. Do not start the next step until the owner confirms the current one works. Design source for each page is the matching file in `docs/prototypes/` (the owner adds the rest); match its layout and behavior using the shared components in `src/components/ui` and `src/components/shared`.

Security reminders that apply to every step: RLS is the real enforcement (add/adjust policies via new migration files); pages call `requireUser()`; Admin/Co-Admin-only pages also check the role server-side; never trust client-supplied ids or URLs.

## Step 1 — Create Event, Fundamentals tab ✅ done

`/events/new`: name, dates, description, Save Draft / Launch Event, real insert. `events_insert` requires `created_by = auth.uid()`.

## Step 2 — Home shows real events

- Replace Home's placeholder with a real list/timeline of events (prototype: `docs/prototypes/index.html` — large file, read only the event list section).
- Draft events render with a **dashed border + grey "Draft" badge** and are visible to **all active Admins and Co-Admins**; Members never see them (enforced by `events_select`; verify, don't re-implement in the UI).
- "+ New Event" button, visible to Admin and Co-Admin only, linking to `/events/new`; add the route to navigation if appropriate.
- After saving on `/events/new`, redirect to Home so the new event is visible.
- Empty state uses the tiger mascot when there are no events.
- **Test:** create one Draft and one Active event → both show for the creator and a different active Admin/Co-Admin; sign in as a Member → the Draft is invisible (list **and** direct URL); a Member has no "+ New Event" button.

## Step 3 — Task Setup (done in code; migrations pending owner rollout)

- The Tasks tab adds editable phases and tasks (title, committee, Deliverable/LiveOperation type, due date, priority default Medium, description, and optional assignees). Live Operations also expose the existing call/end-time fields with a live-duty warning. Unassigned tasks use empty assignee arrays and land in the Backlog. Empty phases are clearly marked and are not persisted because phases live in `tasks.phase`, not a separate table.
- `create_event_with_tasks(...)` atomically inserts the event and up to 200 tasks as `SECURITY INVOKER`, derives `created_by` from `auth.uid()`, rejects missing required task keys, validates text lengths/enums/dates/times, and accepts any active user as an assignee. Drafts may have zero tasks; Active events must have at least one task, enforced in both the UI and function.
- Co-Admins see only their committee in the task editor, while the function and `tasks_insert` RLS reject cross-committee inserts.
- The searchable assignee picker uses a restricted security-definer function rather than loosening `users` RLS. It lists active users across committees with only their id, name, committee, and avatar; the task's committee is grouped first and existing selections survive committee changes.
- Draft task rows, `get_task()` results, assignee status updates, and activity-log snapshots are hidden from Members until the parent event is launched. Active Admins retain full access; active Co-Admins retain access to Draft tasks in their own committee.
- **Test:** launch an event with 3 tasks → 3 rows with the right `event_id` / `committee_id`; an Active event with zero tasks → rejected atomically; a Co-Admin task for another committee → rejected; a cross-committee active assignee → accepted; an inactive assignee → rejected; a Member cannot read the assignee-list function, a Draft task, or its activity log.

## Step 4 — Edit Event

- Load an existing event (and its tasks) into the same form; any active Admin or Co-Admin may edit any Draft or Active event (`events_update`). A Co-Admin may launch any Draft by changing it to Active, but nobody may change an Active event back to Draft. Only an Admin may archive an event, and an Archived event cannot be updated or un-archived.
- Prototype: `docs/prototypes/edit-event.html` (large file, read only the parts you need).
- **Test:** edit name/dates as a non-creator Co-Admin → saved; launch another creator's Draft as a Co-Admin → saved; attempting to change Active back to Draft as a Co-Admin is rejected; attempting to archive as a Co-Admin is rejected; attempting to edit or un-archive an Archived event is rejected.

## Step 5 — Template Auto-Import ✅ done in code; migration pending owner rollout

- "Start from Archive Template" lists Archived events; a Supabase SQL function duplicates the chosen event's tasks into the new event.
- Relative scheduling: `new_task_deadline = new_event_start + (old_task_deadline − old_event_start)`.
- Assignees are wiped; tasks route to the Backlog.
- **Test:** import into a future event → dates shift correctly, backlog populated, no assignees.

## Step 6 — Event Archives (read-only)

- `/archives` lists Archived events; an Admin action sets `status = 'Archived'`.
- Archived events are frozen and cannot be un-archived: the event row is already blocked by `events_update`; Step 6 must **finish enforcing read-only in the database** for its tasks and related writes, not only by hiding buttons. Historical comments and Drive links stay readable.
- **Test:** archive an event → dragging/editing/commenting is blocked even via a direct API call.

## Step 7 — Banner upload

- New public `banners` bucket (created by hand per environment; ~1.5 MB limit; JPEG/PNG/WebP) with storage policies in a **migration file**, mirroring the `avatars` bucket pattern.
- Crop 16:9, compress to 1–1.5 MB WebP client-side, upload, then save `banner_url` through a server route that computes/validates the expected URL itself (same pattern as `/api/update-avatar` — never accept a client-supplied URL).
- **Test:** a 4 MB photo is rejected/forced through crop; the banner shows on the event; the old file is replaced on re-upload.

## Step 8 — Google Drive preview helper

- Build `toPreviewUrl()` and a small `DrivePreview` component (see `docs/ARCHITECTURE.md` §1) with the plain-link fallback and "Preview unavailable" note. The task modal is a Phase 4 feature, so ship the component now with a tiny demo/test and wire it into the modal when that exists.
- **Test:** a valid share link renders an inline preview; plain text falls back to a link, never a broken iframe.

## Phase 3 gate (from the architecture doc)

Auto-import lands relative dates correctly and populates the backlog with no assignees; a valid Drive link previews and plain text falls back; active Admins and Co-Admins can see and edit any Draft, while a Member cannot see a Draft even via direct URL; a Co-Admin can launch any Draft but cannot change Active back to Draft or archive one; an Archived event cannot be updated or un-archived.

# CEIT Connect — Architecture (condensed from Master System Architecture v3)

Source of truth for *what the system must do*. Where the team deliberately differs from the original document, it is listed under **Approved deviations** at the bottom — follow the deviation, not the original text.

## 1. Stack and storage

- Next.js (App Router) + TypeScript + React Query; Tailwind + shadcn/Base UI + Lucide; dnd-kit (drag and drop); react-mentions (smart tagging).
- Supabase: Postgres, Auth, Storage, Realtime, SQL triggers.
- **Zero-cost file storage:** users never upload documents/PDFs. A task's "Your Work" field is a text input where they paste a Google Drive link.
- **Images (client-side only):** reject files > 2 MB, crop with `react-easy-crop`, compress with `browser-image-compression`, upload only the compressed `.webp/.jpeg`. Profile photos < 500 KB; event banners 1–1.5 MB.
- **External:** Google Calendar (static "Add to Calendar" link only, no sync), Discord webhooks (not built yet), email.
- **Environment separation:** separate Supabase projects for Dev and Prod. The service-role key lives only in server-side env vars and every route using it re-verifies the caller's role.

### Google Drive PDF preview (build in Phase 3)

```ts
function toPreviewUrl(shareUrl: string): string | null {
  const match = shareUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return null;
  return `https://drive.google.com/file/d/${match[1]}/preview`;
}
// <iframe src={toPreviewUrl(link)} className="w-full h-96 rounded-lg border" />
```
If it returns `null`, show a plain "Open link" button, never a broken iframe. Previews only work when the file is shared as "Anyone with the link can view"; a denied iframe can't be detected, so also show a quiet "Preview unavailable — check sharing settings" note.

## 2. Roles (RBAC)

- **Admin** (Executive Board): everything — all committees, events, invites, task overrides, global dashboard.
- **Co-Admin** (committee head): own committee's tasks, creating tasks inside events, assigning own members, requesting Assists.
- **Member**: view/comment/status-update only on tasks assigned to them.
- Committees: President (Executive Board), CIA, COEXA, COMRECS, COFBUM, CARA, COPI, COPR, COBAP, COSEA, COSCA, COSRAW — stored in a lookup table so renaming/retiring one is a data update, not a migration.
- Co-Admins see/manage only their own committee's members — enforced by RLS, not client filtering.

## 3. User lifecycle

- **No public sign-up.** Admin invites by university email with a role + committee.
- **Offboarding:** never delete users (protects Event Archives). Admin toggles `is_active`; deactivation locks the user out, deletes their avatar file from Storage, and nulls `avatar_url`. Reactivating is the same toggle in reverse (a returning member needs no new invite).

## 4. Modules and navigation

- **Home — Event Kanban and Backlog:** phase tabs reveal three lanes (TO DO, IN PROGRESS, COMPLETED). Unassigned tasks wait in a collapsible Backlog drawer. Admins can filter by committee. Draft events render with a dashed border + grey badge.
- **Workspace:** *My Tasks* (personal feed, closest deadline first) and *Help Wanted* (council-wide tasks flagged "Request Backup").
- **Executive Dashboard** (two-level drill-down bar chart): Level 1 (Admin only) = one bar per committee sized by active tasks. Level 2 = one bar per member of a committee. Admins land on Level 1; Co-Admins land directly on their own committee's Level 2; Members don't see the chart. Names/avatars must be **always visible on the chart** (no hover-only identification — touchscreens). A committee with zero active tasks shows the sleeping-tiger empty state.
- **Event Archives:** completed events frozen read-only (no drag, comment, or edit); historical chat and Drive links stay readable.
- **Activity Log:** immutable audit trail via Postgres triggers on every task INSERT/UPDATE/DELETE. SELECT-only via RLS **and** matching GRANT restrictions (RLS alone doesn't stop BYPASSRLS roles).
- **Notifications:** the bell is backed by a persistent `notifications` table (not inferred from Realtime). Realtime only pushes new rows live; the table makes unread counts correct after refresh or offline.

### UI defense in depth
Hiding a nav icon is UX polish, not security. Every UI role check must have a matching RLS policy or server check — a Member can still type `/activity-log` or call an API by hand.

## 5. Events, drafts, templates

- 3-part creation flow: Event Fundamentals → Task Setup (by phase) → Review. "Save as Draft" is available throughout.
- **Draft events** are visible to their creator and every other active Admin or Co-Admin; Members never see Drafts, including by direct URL (RLS-enforced). Any active Admin or Co-Admin may edit any Draft or Active event, and a Co-Admin may launch any Draft by changing it to Active. An Active event cannot return to Draft. Only an Admin may archive or delete an event. Archived events cannot be updated or un-archived.
- **Template Auto-Import:** "Start from Archive Template" duplicates a past event's tasks via a Supabase SQL function. Relative scheduling: `new_task_deadline = new_event_start + (old_task_deadline − old_event_start)`. Assignees are wiped; tasks land in the Backlog.

## 6. Task engine

- **Smart assignment:** assignee dropdown shows workload ("Maria (4 Active Tasks)"), filtered to the Co-Admin's committee. Backlog tasks can be self-claimed ("Claim Task").
- **Assist system:** "Request Backup" flags a task with an orange "Help Wanted" badge, visible council-wide. Any member can "Volunteer"; the creator accepts, adding the volunteer to `assist_assignees` and granting edit rights.
- **Dependencies:** if Task B depends on Task A, B shows a lock icon and "Start Task" is disabled until A is Completed.
- **Confidential tasks:** RLS is row-level and cannot show a masked title while hiding the description, so a `SECURITY DEFINER` function `get_task(p_task_id)` returns either the real data or a masked "Confidential Task" row. Real content is visible to: Admin; Co-Admin of the same committee; primary assignees; assist assignees; and anyone in `allowed_viewers`. The function's own `can_view` logic is the security boundary — keep it simple and never build it from user-supplied text. **The board must always call `get_task`, never a raw select, wherever confidentiality matters.**
- **Status updates:** desktop drag-and-drop (dnd-kit, optimistic updates); mobile circular tap-checkbox → Completed. No drag-to-delete; deletion is a confirmed button inside the Task Modal, restricted to Admins/creators.
- **Priorities:** default Medium; auto-escalates to High 24 hours before due; Critical (flashing red) once overdue.
- **Comments:** per-task thread via react-mentions; `@mention` targets one user; "Heads Up" blasts all assignees.

## 7. Notifications (three levels)

1. In-app bell (source of truth, `notifications` table).
2. Discord webhooks for urgent events (unlock, backup request, mention, heads-up) using `<@DiscordID>`. Discord caps ~30 messages/min per channel — queue and debounce, never fire inline per event. *(Not built; may not be built.)*
3. Email for critical items only: invites plus a daily scheduled warning for "24 hours until overdue" (stay under the free-tier daily cap).

## 8. UI/UX and branding

White/slate backgrounds; orange only for primary actions (login buttons, progress bars, Request Backup badges). Empty states use the tiger mascot (sleeping/relaxed for empty lists, confused for errors/404). Avatar fallback = colored circle with initials, including after deactivation.

## 9. Backup and recovery

Supabase free tier has no automated backups. A designated Technical Lead exports the database weekly from the dashboard; recovery = re-import the latest export. Documented as a runbook at `/docs/BACKUP.md` (to be written in Phase 5, and the export must actually be run once to prove it works). A paid plan would add daily backups/PITR later.

## 10. Phased build plan

| Phase | Focus | Status |
|---|---|---|
| 0 | Environment, UI foundations, Vercel | Done |
| 1 | Database, security, RLS | Done |
| 2 | Auth, image pipeline, offboarding | Done |
| 3 | Event engine, drafts, relative scheduling, archives | **In progress** |
| 4 | Task engine, Kanban, dependencies, confidentiality UI | Not started |
| 5 | Notifications, dashboard wiring, ops handover | Not started |

**Phase 3 gate checks:** auto-import lands relative dates correctly and populates the backlog with no assignees; a valid Drive link renders an inline preview and plain text falls back to a link; active Admins and Co-Admins can see and edit any Draft, while a Member cannot see a Draft even via direct URL; a Co-Admin can launch any Draft but cannot change Active back to Draft or archive one; an Archived event cannot be updated or un-archived.
**Phase 4 gate checks:** blocked task unlocks when its dependency completes; a non-assigned Member sees only "Confidential Task" on the board and in the modal; drag-and-drop works on desktop and tap-checkbox on a real phone.
**Phase 5 gate checks:** a burst of 40+ mentions throttles gracefully; a Co-Admin lands on their own committee with no Level 1 access, a Member has no dashboard link and the URL is blocked server-side; the unread count survives a refresh after an offline notification.

## Approved deviations from the original document

- **Sign-in methods:** besides the magic link, accounts can use a password (set in Settings after the first login) and Google sign-in. Google works only for invited users who have already set a password (gated in `/auth/callback`). Forgot-password uses a typed 6-digit emailed code, not a link.
- **Email:** Supabase custom SMTP through a Gmail App Password (interim) instead of Resend, because Resend needs a verified domain to email arbitrary recipients and the team has no domain yet.
- **Invites and user management are Admin-only** (the original text implied Co-Admins could manage their committee's members).
- **`allowed_viewers uuid[]`** was added to `tasks` so an assignee or committee head can grant extra people access to a confidential task (the sixth condition in `get_task`).
- **Invites are limited to approved email domains** via the `ALLOWED_EMAIL_DOMAINS` env var (Dev also allows `gmail.com` for testing; Prod will be tightened to the university domain).
- **Deactivate and Reactivate** are both supported (original described only deactivation).
- **`discord_id` settings field is deferred** until Discord webhooks are actually scheduled.
- **Event access:** Drafts are visible to all active Admins and Co-Admins, not only their creator. Any active Admin or Co-Admin may edit or launch any Draft or Active event; Active events cannot return to Draft; only Admins may archive or delete events; `created_by` is immutable; and Archived events cannot be updated or un-archived.

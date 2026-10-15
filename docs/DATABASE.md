# CEIT Connect — Database reference

Postgres on Supabase. **Every table has Row-Level Security (RLS) enabled** — the database, not the app, decides who can see or change each row. If anything here disagrees with `supabase/migrations/`, the migration files win (see "Verify" notes).

## Tables

### committees

`id uuid pk`, `name text`. 12 rows (President, CIA, COEXA, COMRECS, COFBUM, CARA, COPI, COPR, COBAP, COSEA, COSCA, COSRAW). A lookup table, not an enum. Any logged-in user can read; only Admin writes.

### users (app profile; one row per person)

`id uuid pk` (**must equal an `auth.users.id`** — Supabase's own login table), `email text`, `full_name text`, `role text` (`Admin` | `Co-Admin` | `Member`), `committee_id uuid → committees.id` (null for Admins), `is_active bool`, `created_at timestamptz`, `password_set bool not null default false`, `discord_id text null`, `avatar_url text null`.

- `password_set` = the person has completed a real first login and set a password; Google sign-in is gated on it.
- A person always needs **both** an `auth.users` row and a `users` row. The Invite flow creates both together and rolls back the login account if the profile insert fails.
- Users are never deleted. Deactivate with `is_active = false`.

### events

`id uuid pk default gen_random_uuid()`, `name text not null`, `description text`, `banner_url text`, `start_date date not null`, `end_date date`, `status text not null default 'Draft'` (`Draft` | `Active` | `Archived`), `created_by uuid not null → users.id`, `created_at timestamptz default now()`, `updated_at timestamptz not null default clock_timestamp()`.

### tasks

`id uuid pk`, `event_id uuid not null → events.id on delete cascade`, `committee_id uuid not null → committees.id`, `title text not null`, `description text`, `phase text`, `status` (`To Do` | `In Progress` | `Completed`, default `To Do`), `priority` (`Low` | `Medium` | `High` | `Critical`, default `Medium`), `task_type` (`Deliverable` | `LiveOperation`, default `Deliverable`), `due_date timestamptz`, `call_time timestamptz`, `end_time timestamptz`, `primary_assignees uuid[] default '{}'`, `assist_assignees uuid[] default '{}'`, `is_confidential bool default false`, `request_backup bool default false`, `depends_on_task_id uuid → tasks.id` (self-reference), `allowed_viewers uuid[] default '{}'`, `created_at`.

- Assignee arrays hold user ids; they are **not** foreign keys. Assignees may be active users from any committee because tasks are collaborative. Membership test in policies: `auth.uid() = any(primary_assignees)`.

### notifications

`id uuid pk default gen_random_uuid()`, `user_id uuid not null → users.id on delete cascade`, `type text not null` (`mention` | `assignment` | `status_change` | `unlock` | `backup_request` | `heads_up`), `task_id uuid → tasks.id on delete cascade` (nullable), `read_at timestamptz` (nullable), `created_at timestamptz not null default now()`. Private to each user (even Admins can't read others'); system-generated only; a user may mark their own as read; nobody deletes.

### activity_log

`id uuid pk default gen_random_uuid()`, `task_id uuid → tasks.id on delete set null`, `user_id uuid → users.id on delete set null`, `action text not null` (`INSERT` | `UPDATE` | `DELETE`), `changes jsonb`, `created_at timestamptz not null default now()`. Written automatically by a trigger on every task INSERT/UPDATE/DELETE; nobody writes it by hand and nothing is ever edited or deleted. Admins see all rows; everyone else sees entries only for tasks they would genuinely have access to (narrower than "can see the task exists" — it was tightened twice to stop confidential and backup-flagged tasks leaking).

## Who can do what (RLS summary)

| Table         | See                                                                                                                                                      | Add                                                         | Edit                                                                                                                                                 | Delete                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| committees    | any logged-in user                                                                                                                                       | Admin                                                       | Admin                                                                                                                                                | Admin                    |
| users         | own row; Co-Admin sees own committee; Admin sees all                                                                                                     | Admin (invite flow, service role)                           | Co-Admin: own committee's members but **cannot promote anyone to Admin**; Admin: anyone                                                              | nobody (deactivate)      |
| events        | Active/Archived for everyone; Drafts for active Admins and Co-Admins (including the creator while still active in either role); Members never see Drafts | active Admin or Co-Admin, **and `created_by = auth.uid()`** | any active Admin or Co-Admin may edit Draft/Active; only Admin may archive an Active event; Draft cannot become Active without an end date and a task; Active cannot return to Draft; Archived cannot be updated or un-archived | active Admin, except Archived events |
| tasks         | Admin all; Co-Admin own committee; on Active events, anyone if `request_backup` and assignees their own; every active user sees non-confidential Archived tasks; existing access still governs confidential Archived tasks; Members cannot see Draft tasks | Admin; Co-Admin within own committee; never in an Archived event | Admin / owning Co-Admin freely; on non-Draft events, a plain assignee may change **status only**; nobody may update a task in an Archived event | Admin or owning Co-Admin; never in an Archived event |
| notifications | own only                                                                                                                                                 | system only                                                 | mark own as read                                                                                                                                     | nobody                   |
| activity_log  | see above                                                                                                                                                | trigger only                                                | nobody                                                                                                                                               | nobody                   |

Policy names for events: `events_select`, `events_insert`, `events_update`, `events_delete`.

`events_select` exposes Drafts to any active Admin or Co-Admin; `my_role()` returns `null` for inactive profiles, so Members and deactivated privileged users cannot see them. `events_update` permits any active Admin or Co-Admin to edit any Draft or Active event. A Co-Admin may launch any Draft by changing it to Active only after the event has an end date and at least one task, but only an Admin may change an Active event to Archived. An Active event cannot return to Draft, a Draft cannot be archived, and an Archived event cannot be updated, un-archived, or deleted. The lifecycle trigger enforces these rules even for service-role writes; `events_delete` also excludes Archived rows as defense in depth.

Task Draft visibility is enforced separately from event visibility. `tasks_select` and the assignee path in `tasks_update` require the parent event not to be Draft; active Admins still have full access and active Co-Admins may access Draft tasks only in their own committee. In addition, every active user may read non-confidential tasks whose parent event is Archived. That branch checks the real parent status through the restricted `event_is_archived()` security-definer helper, so caller-scoped event RLS cannot hide or alter the answer; confidential Archived tasks retain the previous policy paths exactly. A fail-closed security-definer trigger rejects every task insert, update, or delete when either its old or new parent event is Archived, regardless of caller role or RLS bypass. `activity_log_select` repeats the Draft parent-status check because `changes` stores full task snapshots. The `get_task()` security-definer function also checks the parent status explicitly and returns no row for a Draft task unless the caller is an active Admin or the active Co-Admin of that task's committee.

## Functions and triggers

- `my_role()` and `my_committee_id()` — `SECURITY DEFINER` helpers that read the caller's role/committee without re-triggering `users` RLS. They exist to avoid the **infinite-recursion** bug (a `users` policy that queries `users`). Reuse them in new policies instead of subquerying `users`.
- `get_task(p_task_id uuid)` — `SECURITY DEFINER` with a fixed empty `search_path`, returns the real row or a masked "Confidential Task" row (see `ARCHITECTURE.md` §6). Every path to real content first requires the caller's profile to be active; the Draft-only guard returns no row unless the caller is an active Admin or the active Co-Admin of the task's committee.
- `list_active_task_assignees()` — `SECURITY DEFINER`, fixed `search_path`, and executable only by `authenticated`. It returns `id`, `full_name`, `committee_id`, and `avatar_url` for active users only, and returns no rows unless the caller is an active Admin or Co-Admin. It exists so the collaborative assignee picker can cross committee boundaries without loosening `users` RLS or exposing email, role, or Discord data.
- `event_is_archived(p_event_id)` — restricted, fixed-empty-`search_path` `SECURITY DEFINER` boolean helper used only by the Archived branch of `tasks_select`. Its fully qualified lookup reads the real parent row independently of caller event visibility; only `authenticated` may execute it.
- `list_archived_event_assignees(p_event_id)` — fixed-empty-`search_path` `SECURITY DEFINER`, executable only by `authenticated`. It returns only `id`, `full_name`, and `avatar_url` for users present in the primary or assist arrays of that Archived event's non-confidential tasks. The caller must be active, non-Archived events return no rows, and deactivated assignees remain named without loosening `users` RLS or exposing email, role, Discord, or committee data.
- `task_update_assignees_are_valid(p_task_id, p_assignee_ids)` — restricted, fixed-`search_path` `SECURITY DEFINER` validation helper that returns only a boolean and never returns profile fields. For an authorized Admin or owning Co-Admin, it reads the task's real stored `primary_assignees`: every proposed id must still exist, newly added ids must be active, and an already-stored id may remain after that user is deactivated. It does not loosen `users` RLS or expose inactive names.
- `create_event_with_tasks(...)` — `SECURITY INVOKER`; atomically inserts one Draft/Active event and up to 200 initial tasks while RLS remains active. It derives `created_by` from `auth.uid()`, rejects an Active event with zero tasks, caps text lengths, validates required JSON keys/types plus enums/dates/times, and requires every assignee to exist and be active. Assignees may belong to any committee, are written to `primary_assignees`, and an empty array leaves the task in the Backlog. Live Operations may save `call_time` and optional `end_time` using the existing task columns.
- `get_archived_event_template(p_template_event_id, p_new_start_date)` — read-only `SECURITY INVOKER` with a fixed empty `search_path`. It is restricted to active Admins/Co-Admins and rejects non-Archived events. Admins may import every RLS-visible committee; Co-Admins have an additional explicit own-committee predicate so assignment or `request_backup` visibility can never pull another committee's task into an import. The same scope applies to the confidential-task count. Confidential tasks are counted but excluded before title/description JSON is constructed. Every returned task has empty assignees and `To Do` status; each non-null due/call/end timestamp is shifted by the integer day difference between the new and archived event start dates. Null timestamps stay null, and more than 200 importable tasks is rejected.
- `edit_event_with_tasks(...)` — `SECURITY INVOKER`; atomically edits a Draft/Active event using an exact expected `updated_at` value plus explicit task-add, task-update, and task-delete lists. It locks the event, rejects stale saves, preserves task status/confidentiality fields, and checks every requested task update/delete affected exactly one RLS-authorized row. Additions still require every assignee to exist and be active. Updates require every assignee to exist, but an assignee already stored on that task may remain after deactivation; only newly added assignees must be active. Co-Admins remain restricted to their own committee. Task mutations happen before Draft-to-Active, only real database `To Do` tasks may be deleted, omitted tasks are untouched, and an Active edit that requests deletions checks the final all-committee task state. The end-date requirement applies only when launching a Draft, so legacy Active rows with a null end date remain editable; legacy zero-task Active rows may also receive ordinary edits or have a corrective task added.
- Activity-log trigger on `tasks`; an **assignee-guard trigger** limiting plain assignees to status changes (it was once written but never attached to the table — always confirm a trigger is actually attached after creating it).
- `guard_event_updates` trigger on `events` — rejects updates where `new.created_by is distinct from old.created_by`, status changes from Active back to Draft, Draft-to-Active transitions when the event has no tasks, every non-Active-to-Archived transition, and every update or delete of an Archived event. Its `SECURITY DEFINER` function has a fixed empty `search_path`, so its task checks see every committee instead of being narrowed by the caller's task RLS. For an allowed Draft/Active event deletion, it removes child tasks while the parent remains verifiable; the existing task/activity/notification cascades still run.
- `tasks_guard_archived_event_writes` trigger on `tasks` — a fixed-empty-`search_path`, `SECURITY DEFINER`, fail-closed guard that reads the real parent event without caller RLS and rejects inserts into, updates within or moves into/out of, and deletes from Archived events. It runs before the assignee guard; rejected writes never reach the activity-log trigger.
- `events_set_updated_at` trigger on `events` — assigns a monotonic value based on `clock_timestamp()` before every event update. The edit RPC always updates the event row, including task-only saves, so every successful edit advances the concurrency token.
- `events_guard_banner_url` trigger on `events` — permits a null banner or a Supabase public banner URL for that event's own `<event_id>/<uuid>.webp` object, and verifies the object already exists through a fixed-search-path security-definer helper. This closes direct insert/update paths that could otherwise store arbitrary URLs.
- `events_require_task_when_inserted_active` / `tasks_preserve_active_event_task_on_delete` / `tasks_preserve_active_event_task_on_event_move` — deferred constraint triggers that enforce at transaction end that a newly inserted Active event and an Active event affected by task deletion or a real `event_id` change retain at least one task. They do not fire for ordinary event/task updates; Drafts may remain empty, same-transaction replacements work, and event deletion remains compatible.
- Known, accepted limitation: the raw `tasks` row is not masked at the database level; confidentiality depends on the app always using `get_task()`.

## Storage

Bucket `avatars`: public read, 2 MB limit, MIME types `image/jpeg`, `image/png`, `image/webp`. Files live at `<user_id>/avatar.webp` (one fixed filename, so re-uploading overwrites). Storage RLS: anyone can read; a user can insert/update/delete only inside the folder named after their own `auth.uid()`. **The bucket itself is not created by migrations** — create it by hand in each environment; the migration only creates the policies.

Bucket `banners`: public read, 2 MB limit, MIME types `image/jpeg`, `image/png`, `image/webp`; it is created by the Step 7 migration. Saved app files live at `<event_id>/<random_uuid>.webp`. Storage writes require an active Admin or Co-Admin and an existing Draft or Active event matching the first folder segment. Missing/malformed events, Members, inactive users, and Archived events fail closed. Replacements use a new filename, update `events.banner_url` first, and only then delete the former object.

Known Storage limitation: Postgres and Storage cannot share a transaction. Directly deleting a Draft event, an archive race between upload and URL save, or a Storage outage during post-update cleanup can leave an unreferenced banner object. Cleanup never bypasses the Archived-event freeze.

## Migrations (apply in this order)

1. `20260925125834_committees_and_users.sql`
2. `20260926044920_fix_users_rls_recursion.sql`
3. `20260926051331_events_and_tasks.sql`
4. `20260926053015_notifications_and_activity_log.sql`
5. `20260926124051_fix_privilege_escalation_and_search_path.sql`
6. `20260927043940_fix_activity_log_leak_and_task_column_guard.sql`
7. `20260927044341_fix_activity_log_backup_confidential_leak.sql`
8. `20260927170612_recreate_missing_assignee_guard_trigger.sql`
9. `20261001135007_add_password_set_column.sql` (includes a backfill from `auth.users.encrypted_password`)
10. `20261002094633_avatar_storage_policies.sql`
11. `20261007061905_tighten_events_insert_policy.sql` — drops and recreates `events_insert` so it also requires `created_by = auth.uid()`
12. `20261011114905_update_event_visibility_and_edit_permissions.sql` — lets active Admins/Co-Admins see and edit all Draft/Active events, reserves archiving for Admins, blocks Active-to-Draft reversals, freezes Archived event rows, and makes `created_by` immutable
13. `20261011180000_enforce_draft_task_visibility.sql` — prevents Members from reading or updating Draft tasks, applies the same rule inside `get_task()`, and prevents Draft task snapshots from leaking through `activity_log`
14. `20261011180100_create_event_with_tasks.sql` — adds the restricted active-assignee listing function plus the invoker-security atomic event-and-task creation function and its input/assignee limits
15. `20261011200000_require_tasks_when_launching_events.sql` — replaces the event update guard so Draft events cannot be launched without a task; the all-committee task existence check runs as a restricted security-definer function
16. `20261011210000_edit_event_with_tasks.sql` — adds `events.updated_at`, its update trigger, and the invoker-security atomic edit RPC with optimistic concurrency, explicit RLS-checked task mutation lists, protected progressed tasks, and task-before-launch ordering
17. `20261011220000_allow_existing_inactive_task_assignees.sql` — replaces the edit RPC with the same signature and permissions, allowing stored inactive assignees to remain or be removed during task updates while still requiring all new assignees to exist and be active
18. `20261012120000_import_archived_event_template.sql` — adds the invoker-security Archived-template reader with explicit own-committee scope for Co-Admins on both imports and confidential counts, confidential-content exclusion, empty assignees, `To Do` resets, null-preserving integer-day date shifts, and a 200-task limit
19. `20261012150000_freeze_archived_events.sql` — preserves all event lifecycle guards, restricts archiving to Active events, blocks Archived event updates/deletes, and adds a fail-closed security-definer task trigger that freezes task inserts/updates/deletes without changing read visibility
20. `20261012160000_expand_archived_task_visibility.sql` — preserves every existing `tasks_select` branch and adds active-user access to non-confidential Archived tasks through a restricted parent-status helper that bypasses caller event RLS
21. `20261012160100_list_archived_event_assignees.sql` — adds the restricted Archived-event assignee-name reader, including deactivated assignees while exposing only id, name, and avatar URL
22. `20261015120000_event_banners.sql` — creates the public banners bucket, adds event-scoped Storage RLS, and guards `events.banner_url` with environment-independent URL-shape and object-existence checks
23. `20261015180000_phase_3_gate_hardening.sql` — requires active callers for real `get_task()` content, aligns Draft-to-Active end-date/task checks with creation, and adds deferred Active-event task-count enforcement for Active inserts and task removal/moves

## Environments

- **Dev** has fake test accounts created directly in SQL (`admin@test.com`, `cia-coadmin@test.com`, `coexa-member@test.com` with ids `1111…`, `2222…`, `3333…`) plus some test events. **Do not assume this data exists in Prod.**
- **Prod** started empty. On a fresh database the very first Admin must be created by hand: Dashboard → Authentication → Users → Add user → Create new user (tick Auto Confirm; do **not** use "Send invitation"), copy the new UUID, then insert a matching `users` row with `role = 'Admin'`. After that, everyone else is invited from the app.
- Only the owner pushes migrations to a remote project (see `AGENTS.md` golden rule 1).

## How to test an RLS policy (simulate a logged-in user in the SQL Editor)

```sql
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '<user-uuid>')::text, true);
select * from events;  -- now filtered exactly as that user would see it
```

Running queries as the default `postgres` role bypasses RLS and proves nothing.

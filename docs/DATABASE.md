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
`id uuid pk default gen_random_uuid()`, `name text not null`, `description text`, `banner_url text`, `start_date date not null`, `end_date date`, `status text not null default 'Draft'` (`Draft` | `Active` | `Archived`), `created_by uuid not null → users.id`, `created_at timestamptz default now()`.

### tasks
`id uuid pk`, `event_id uuid not null → events.id on delete cascade`, `committee_id uuid not null → committees.id`, `title text not null`, `description text`, `phase text`, `status` (`To Do` | `In Progress` | `Completed`, default `To Do`), `priority` (`Low` | `Medium` | `High` | `Critical`, default `Medium`), `task_type` (`Deliverable` | `LiveOperation`, default `Deliverable`), `due_date timestamptz`, `call_time timestamptz`, `end_time timestamptz`, `primary_assignees uuid[] default '{}'`, `assist_assignees uuid[] default '{}'`, `is_confidential bool default false`, `request_backup bool default false`, `depends_on_task_id uuid → tasks.id` (self-reference), `allowed_viewers uuid[] default '{}'`, `created_at`.
- Assignee arrays hold user ids; they are **not** foreign keys. Membership test in policies: `auth.uid() = any(primary_assignees)`.

### notifications
`id uuid pk default gen_random_uuid()`, `user_id uuid not null → users.id on delete cascade`, `type text not null` (`mention` | `assignment` | `status_change` | `unlock` | `backup_request` | `heads_up`), `task_id uuid → tasks.id on delete cascade` (nullable), `read_at timestamptz` (nullable), `created_at timestamptz not null default now()`. Private to each user (even Admins can't read others'); system-generated only; a user may mark their own as read; nobody deletes.

### activity_log
`id uuid pk default gen_random_uuid()`, `task_id uuid → tasks.id on delete set null`, `user_id uuid → users.id on delete set null`, `action text not null` (`INSERT` | `UPDATE` | `DELETE`), `changes jsonb`, `created_at timestamptz not null default now()`. Written automatically by a trigger on every task INSERT/UPDATE/DELETE; nobody writes it by hand and nothing is ever edited or deleted. Admins see all rows; everyone else sees entries only for tasks they would genuinely have access to (narrower than "can see the task exists" — it was tightened twice to stop confidential and backup-flagged tasks leaking).

## Who can do what (RLS summary)

| Table | See | Add | Edit | Delete |
|---|---|---|---|---|
| committees | any logged-in user | Admin | Admin | Admin |
| users | own row; Co-Admin sees own committee; Admin sees all | Admin (invite flow, service role) | Co-Admin: own committee's members but **cannot promote anyone to Admin**; Admin: anyone | nobody (deactivate) |
| events | Active/Archived for everyone; **Drafts only to their creator** | Admin or Co-Admin, **and `created_by = auth.uid()`** | creator or Admin | Admin |
| tasks | Admin all; Co-Admin own committee; anyone if `request_backup`; assignees their own | Admin; Co-Admin within own committee | Admin / owning Co-Admin freely; a plain assignee may change **status only** (guard trigger) | Admin or owning Co-Admin |
| notifications | own only | system only | mark own as read | nobody |
| activity_log | see above | trigger only | nobody | nobody |

Policy names for events: `events_select`, `events_insert`, `events_update`, `events_delete`.

## Functions and triggers

- `my_role()` and `my_committee_id()` — `SECURITY DEFINER` helpers that read the caller's role/committee without re-triggering `users` RLS. They exist to avoid the **infinite-recursion** bug (a `users` policy that queries `users`). Reuse them in new policies instead of subquerying `users`.
- `get_task(p_task_id uuid)` — `SECURITY DEFINER`, returns the real row or a masked "Confidential Task" row (see `ARCHITECTURE.md` §6). All `SECURITY DEFINER` functions must `set search_path = public`.
- Activity-log trigger on `tasks`; an **assignee-guard trigger** limiting plain assignees to status changes (it was once written but never attached to the table — always confirm a trigger is actually attached after creating it).
- Known, accepted limitation: the raw `tasks` row is not masked at the database level; confidentiality depends on the app always using `get_task()`.

## Storage

Bucket `avatars`: public read, 2 MB limit, MIME types `image/jpeg`, `image/png`, `image/webp`. Files live at `<user_id>/avatar.webp` (one fixed filename, so re-uploading overwrites). Storage RLS: anyone can read; a user can insert/update/delete only inside the folder named after their own `auth.uid()`. **The bucket itself is not created by migrations** — create it by hand in each environment; the migration only creates the policies.

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
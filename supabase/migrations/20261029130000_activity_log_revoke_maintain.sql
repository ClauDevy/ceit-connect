-- Remove every client privilege on the activity log, including PostgreSQL 17 MAINTAIN.

revoke all on table public.activity_log from public, anon, authenticated;

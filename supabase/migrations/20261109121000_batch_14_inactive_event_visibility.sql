-- Phase 4B Batch 14: close the remaining non-Draft event read path for an
-- authenticated JWT whose profile is missing or inactive. Active-role Draft
-- and non-Draft behavior remains unchanged.

do $$
declare
  v_helper_definition text;
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 14 event visibility hardening must be applied by postgres; current_user is %.',
      current_user;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policy as policy_row
    where policy_row.polrelid = 'public.events'::regclass
      and policy_row.polname = 'events_select'
      and policy_row.polcmd = 'r'
      and policy_row.polroles = array['authenticated'::regrole::oid]
      and pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid)
        like '%status <> ''Draft''%'
      and pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid)
        like '%my_role()%'
      and pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid)
        not like '%my_role() IS NOT NULL%'
  ) then
    raise exception 'Batch 14 stopped: events_select no longer matches the latest pre-Batch-14 body.';
  end if;

  v_helper_definition := pg_catalog.pg_get_functiondef(
    'ceit_connect_private.activity_event_status_visible_for_user(text,uuid)'::regprocedure
  );

  if not (
    v_helper_definition like '%select p_event_status <> ''Draft''%'
    and v_helper_definition like '%or exists (%'
    and v_helper_definition like '%profile.id = p_user_id%'
    and v_helper_definition like '%profile.is_active%'
    and v_helper_definition like '%profile.role in (''Admin'', ''Co-Admin'')%'
    and v_helper_definition not like '%select exists (%'
  ) then
    raise exception 'Batch 14 stopped: the event-status mirror is not the latest pre-Batch-14 body.';
  end if;
end
$$;

drop policy "events_select" on public.events;

create policy "events_select"
on public.events for select
to authenticated
using (
  public.my_role() is not null
  and (
    status <> 'Draft'
    or public.my_role() in ('Admin', 'Co-Admin')
  )
);

create or replace function ceit_connect_private.activity_event_status_visible_for_user(
  p_event_status text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.users as profile
    where profile.id = p_user_id
      and profile.is_active
      and (
        p_event_status <> 'Draft'
        or profile.role in ('Admin', 'Co-Admin')
      )
  );
$$;

alter function ceit_connect_private.activity_event_status_visible_for_user(text, uuid)
owner to postgres;
revoke all on function ceit_connect_private.activity_event_status_visible_for_user(text, uuid)
from public, anon, authenticated, service_role;

comment on function ceit_connect_private.activity_event_status_visible_for_user(text, uuid) is
  'Mirrors effective events_select exactly: an active profile is required for every status; active Admins and Co-Admins also see Draft. list_activity_log keeps its separate caller guard.';

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_policy as policy_row
    where policy_row.polrelid = 'public.events'::regclass
      and policy_row.polname = 'events_select'
      and policy_row.polcmd = 'r'
      and policy_row.polroles = array['authenticated'::regrole::oid]
      and pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid)
        like '%my_role() IS NOT NULL%'
      and pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid)
        like '%status <> ''Draft''%'
      and pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid)
        like '%''Admin''%'
      and pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid)
        like '%''Co-Admin''%'
  ) then
    raise exception 'Batch 14 events_select catalog definition is not the approved inactive-safe policy.';
  end if;

  if pg_catalog.has_function_privilege(
    'authenticated',
    'ceit_connect_private.activity_event_status_visible_for_user(text,uuid)',
    'EXECUTE'
  ) then
    raise exception 'Batch 14 activity event-visibility helper must remain private.';
  end if;
end
$$;

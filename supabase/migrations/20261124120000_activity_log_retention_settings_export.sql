-- Batch E1: Admin-managed Activity Log retention and bounded safe export.
-- The environment-specific pg_cron job remains an owner-created operation.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch E1 must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create table ceit_connect_private.activity_log_settings (
  singleton boolean primary key default true check (singleton),
  retention_days integer not null
    check (retention_days between 30 and 730),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_by uuid
);

alter table ceit_connect_private.activity_log_settings owner to postgres;
alter table ceit_connect_private.activity_log_settings enable row level security;
revoke all on table ceit_connect_private.activity_log_settings
from public, anon, authenticated, service_role;

insert into ceit_connect_private.activity_log_settings (
  singleton,
  retention_days,
  updated_by
) values (true, 30, null);

create or replace function public.activity_log_retention_days()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select setting.retention_days
  from ceit_connect_private.activity_log_settings as setting
  where setting.singleton;
$$;

alter function public.activity_log_retention_days() owner to postgres;
revoke all on function public.activity_log_retention_days()
from public, anon, authenticated, service_role;

create function public.get_activity_log_retention_setting()
returns table (
  retention_days integer,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active
      and profile.role = 'Admin'
  ) then
    raise exception using
      errcode = 'CAL04',
      message = 'Activity Log administration is unavailable.';
  end if;

  return query
  select setting.retention_days, setting.updated_at, setting.updated_by
  from ceit_connect_private.activity_log_settings as setting
  where setting.singleton;
end;
$$;

alter function public.get_activity_log_retention_setting() owner to postgres;
revoke all on function public.get_activity_log_retention_setting()
from public, anon, authenticated, service_role;
grant execute on function public.get_activity_log_retention_setting()
to authenticated;

create function public.set_activity_log_retention_days(
  p_retention_days integer
)
returns table (
  retention_days integer,
  updated_at timestamptz,
  updated_by uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
begin
  if not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active
      and profile.role = 'Admin'
  ) then
    raise exception using
      errcode = 'CAL04',
      message = 'Activity Log administration is unavailable.';
  end if;

  if p_retention_days is null or p_retention_days not between 30 and 730 then
    raise exception using
      errcode = 'CAL02',
      message = 'The Activity Log retention value is invalid.';
  end if;

  return query
  update ceit_connect_private.activity_log_settings as setting
  set retention_days = p_retention_days,
      updated_at = pg_catalog.clock_timestamp(),
      updated_by = v_caller_id
  where setting.singleton
  returning setting.retention_days, setting.updated_at, setting.updated_by;

  if not found then
    raise exception using
      errcode = 'CAL05',
      message = 'The Activity Log retention setting is unavailable.';
  end if;
end;
$$;

alter function public.set_activity_log_retention_days(integer)
owner to postgres;
revoke all on function public.set_activity_log_retention_days(integer)
from public, anon, authenticated, service_role;
grant execute on function public.set_activity_log_retention_days(integer)
to authenticated;

create function public.list_activity_log_export(
  p_sort text default 'newest',
  p_action text default null,
  p_committee_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_search text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 500
)
returns table (
  activity_id uuid,
  activity_created_at timestamptz,
  action text,
  task_id uuid,
  task_title text,
  event_name text,
  committee_id uuid,
  committee_name text,
  actor_name text,
  change_summary text[],
  is_masked boolean,
  has_more boolean,
  next_cursor_created_at timestamptz,
  next_cursor_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_cursor_created_at timestamptz := p_cursor_created_at;
  v_cursor_id uuid := p_cursor_id;
  v_inner_has_more boolean := true;
  v_next_created_at timestamptz;
  v_next_id uuid;
  v_count integer := 0;
  v_inner_calls integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_row record;
begin
  if not exists (
    select 1
    from public.users as profile
    where profile.id = v_caller_id
      and profile.is_active
      and profile.role = 'Admin'
  ) then
    raise exception using
      errcode = 'CAL04',
      message = 'Activity Log administration is unavailable.';
  end if;

  if p_page_size is null or p_page_size not between 1 and 500 then
    raise exception using
      errcode = 'CAL02',
      message = 'The activity log request is invalid.';
  end if;

  while v_inner_has_more and v_count < p_page_size and v_inner_calls < 5 loop
    v_inner_calls := v_inner_calls + 1;
    v_inner_has_more := false;
    v_next_created_at := null;
    v_next_id := null;

    for v_row in
      select *
      from public.list_activity_log(
        p_task_id => null,
        p_sort => p_sort,
        p_action => p_action,
        p_committee_id => p_committee_id,
        p_date_from => p_date_from,
        p_date_to => p_date_to,
        p_search => p_search,
        p_cursor_created_at => v_cursor_created_at,
        p_cursor_id => v_cursor_id,
        p_page_size => least(20, p_page_size - v_count)
      )
    loop
      v_inner_has_more := coalesce(v_row.has_more, false);
      v_next_created_at := v_row.next_cursor_created_at;
      v_next_id := v_row.next_cursor_id;

      if v_row.activity_id is not null then
        v_results := v_results || pg_catalog.jsonb_build_array(
          pg_catalog.jsonb_build_object(
            'activity_id', v_row.activity_id,
            'activity_created_at', v_row.activity_created_at,
            'action', v_row.action,
            'task_id', v_row.task_id,
            'task_title', v_row.task_title,
            'event_name', v_row.event_name,
            'committee_id', v_row.committee_id,
            'committee_name', v_row.committee_name,
            'actor_name', v_row.actor_name,
            'change_summary', v_row.change_summary,
            'is_masked', v_row.is_masked
          )
        );
        v_count := v_count + 1;
      end if;
    end loop;

    if v_inner_has_more then
      if v_next_created_at is null or v_next_id is null then
        raise exception using
          errcode = 'CAL05',
          message = 'Activity Log export could not continue.';
      end if;
      v_cursor_created_at := v_next_created_at;
      v_cursor_id := v_next_id;
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(v_results) = 0 and v_inner_has_more then
    return query select
      null::uuid,
      null::timestamptz,
      null::text,
      null::uuid,
      null::text,
      null::text,
      null::uuid,
      null::text,
      null::text,
      null::text[],
      null::boolean,
      true,
      v_next_created_at,
      v_next_id;
    return;
  end if;

  return query
  select
    (entry.value ->> 'activity_id')::uuid,
    (entry.value ->> 'activity_created_at')::timestamptz,
    entry.value ->> 'action',
    (entry.value ->> 'task_id')::uuid,
    entry.value ->> 'task_title',
    entry.value ->> 'event_name',
    (entry.value ->> 'committee_id')::uuid,
    entry.value ->> 'committee_name',
    entry.value ->> 'actor_name',
    case
      when entry.value -> 'change_summary' is null
        or entry.value -> 'change_summary' = 'null'::jsonb then null
      else array(
        select pg_catalog.jsonb_array_elements_text(
          entry.value -> 'change_summary'
        )
      )
    end,
    (entry.value ->> 'is_masked')::boolean,
    v_inner_has_more,
    case when v_inner_has_more then v_next_created_at else null end,
    case when v_inner_has_more then v_next_id else null end
  from pg_catalog.jsonb_array_elements(v_results) as entry(value);
end;
$$;

alter function public.list_activity_log_export(
  text, text, uuid, date, date, text, timestamptz, uuid, integer
) owner to postgres;
revoke all on function public.list_activity_log_export(
  text, text, uuid, date, date, text, timestamptz, uuid, integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_activity_log_export(
  text, text, uuid, date, date, text, timestamptz, uuid, integer
) to authenticated;

comment on table ceit_connect_private.activity_log_settings is
  'Private singleton for the rolling Activity Log retention window. It has no event/task foreign keys and updated_by is metadata only.';
comment on function public.activity_log_retention_days() is
  'Returns the saved rolling Activity Log retention window in whole days.';
comment on function public.set_activity_log_retention_days(integer) is
  'Lets an active Admin save 30 through 730 days without running the purge.';
comment on function public.list_activity_log_export(
  text, text, uuid, date, date, text, timestamptz, uuid, integer
) is
  'Returns an active Admin-only bounded page by delegating all shaping and masking to list_activity_log().';

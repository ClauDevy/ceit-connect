-- Phase 4B Batch 13d: narrow whole-event deletion, retained activity UUIDs,
-- and durable post-commit banner cleanup.

do $$
declare
  v_can_create_roles boolean;
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 13d must be applied by postgres; current_user is %.', current_user;
  end if;

  select role_row.rolsuper or role_row.rolcreaterole
  into v_can_create_roles
  from pg_catalog.pg_roles as role_row
  where role_row.rolname = current_user;

  if not coalesce(v_can_create_roles, false) then
    raise exception 'Batch 13d requires postgres to create the dedicated NOLOGIN executor role.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_roles as role_row
    where role_row.rolname = 'ceit_event_delete_executor'
  ) then
    execute 'create role ceit_event_delete_executor '
      || 'nologin noinherit nosuperuser nocreaterole nocreatedb '
      || 'noreplication nobypassrls';
  end if;
end
$$;
 
-- Batch 12's fixed shape remains unchanged. Only its missing-live-task branch
-- gains retained-UUID orphan handling and the fail-closed ever-confidential rule.
create or replace function public.list_activity_log(
  p_task_id uuid default null,
  p_sort text default 'newest',
  p_action text default null,
  p_committee_id uuid default null,
  p_date_from date default null,
  p_date_to date default null,
  p_search text default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 20
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
  v_caller_role text;
  v_caller_active boolean;
  v_exact_primary uuid[];
  v_exact_assist uuid[];
  v_search text := pg_catalog.btrim(
    coalesce(p_search, ''),
    E' \t\n\r\f\v'
  );
  v_from timestamptz;
  v_until timestamptz;
  v_candidate record;
  v_snapshot jsonb;
  v_old_snapshot jsonb;
  v_snapshot_valid boolean;
  v_row_masked boolean;
  v_row_task_id uuid;
  v_row_title text;
  v_row_event_name text;
  v_row_committee_id uuid;
  v_row_committee_name text;
  v_row_actor_name text;
  v_row_summary text[];
  v_action_label text;
  v_results jsonb := '[]'::jsonb;
  v_match_count integer := 0;
  v_scanned integer := 0;
  v_candidate_overflow boolean := false;
  v_has_more boolean := false;
  v_next_created_at timestamptz;
  v_next_id uuid;
  v_entry jsonb;
  v_cursor refcursor;
  v_last_created_at timestamptz;
  v_last_id uuid;
  v_deleted_event_name text;
  v_deleted_event_status text;
  v_orphan_has_confidential boolean;
  v_orphan_evidence_invalid boolean;
  v_orphan_parent_allowed boolean;
begin
  if p_sort is null or p_sort not in ('newest', 'oldest')
     or p_action is not null
        and p_action not in ('INSERT', 'UPDATE', 'DELETE')
     or p_page_size is null or p_page_size not between 1 and 20
     or (p_cursor_created_at is null) <> (p_cursor_id is null)
     or p_date_from is not null and p_date_to is not null
        and p_date_from > p_date_to
     or pg_catalog.char_length(v_search) > 100
     or exists (
       select 1
       from pg_catalog.generate_series(
         1,
         pg_catalog.char_length(v_search)
       ) as positions(character_position)
       where pg_catalog.ascii(
         pg_catalog.substr(v_search, positions.character_position, 1)
       ) between 0 and 31
       or pg_catalog.ascii(
         pg_catalog.substr(v_search, positions.character_position, 1)
       ) = 127
     ) then
    raise exception using
      errcode = 'CAL02',
      message = 'The activity log request is invalid.';
  end if;

  -- Date inputs are Philippine calendar dates. The browser never constructs
  -- these instants; PostgreSQL alone converts the inclusive day range.
  v_from := case
    when p_date_from is null then null
    else p_date_from::timestamp at time zone 'Asia/Manila'
  end;
  v_until := case
    when p_date_to is null then null
    else (p_date_to + 1)::timestamp at time zone 'Asia/Manila'
  end;

  select profile.role, profile.is_active
  into v_caller_role, v_caller_active
  from public.users as profile
  where profile.id = v_caller_id;

  if not found or not coalesce(v_caller_active, false) then
    raise exception using
      errcode = 'CAL01',
      message = 'Activity history is unavailable.';
  end if;

  if p_task_id is null then
    if v_caller_role not in ('Admin', 'Co-Admin') then
      raise exception using
        errcode = 'CAL01',
        message = 'Activity history is unavailable.';
    end if;
  else
    select stored.primary_assignees, stored.assist_assignees
    into v_exact_primary, v_exact_assist
    from public.tasks as stored
    where stored.id = p_task_id;

    if not found
       or public.task_content_access_for_user(p_task_id, v_caller_id)
          is distinct from 'real'
       or (
         v_caller_role = 'Member'
         and not (
           coalesce(v_caller_id = any(v_exact_primary), false)
           or coalesce(v_caller_id = any(v_exact_assist), false)
         )
       )
       or v_caller_role is null
       or v_caller_role not in ('Admin', 'Co-Admin', 'Member') then
      raise exception using
        errcode = 'CAL01',
        message = 'Activity history is unavailable.';
    end if;
  end if;

  -- One direction-specific query per sort so the (created_at, id) index can
  -- serve ORDER BY. Both share the single loop body below.
  if p_sort = 'newest' then
  open v_cursor for
    select
      log_row.id,
      log_row.task_id as stored_task_id,
      log_row.user_id,
      log_row.action,
      log_row.changes,
      log_row.created_at,
      live_task.id as live_task_id,
      live_task.committee_id as live_committee_id,
      live_event.name as live_event_name,
      live_committee.name as live_committee_name,
      actor.full_name as stored_actor_name,
      actor.anonymized_at as actor_anonymized_at
    from public.activity_log as log_row
    left join public.tasks as live_task
      on live_task.id = log_row.task_id
    left join public.events as live_event
      on live_event.id = live_task.event_id
    left join public.committees as live_committee
      on live_committee.id = live_task.committee_id
    left join public.users as actor
      on actor.id = log_row.user_id
    where (p_action is null or log_row.action = p_action)
      and (v_from is null or log_row.created_at >= v_from)
      and (v_until is null or log_row.created_at < v_until)
      and (p_task_id is null or log_row.task_id = p_task_id)
      and (
        p_cursor_created_at is null
        or (log_row.created_at, log_row.id)
           < (p_cursor_created_at, p_cursor_id)
      )
    order by log_row.created_at desc, log_row.id desc
    limit 2001;
  else
  open v_cursor for
    select
      log_row.id,
      log_row.task_id as stored_task_id,
      log_row.user_id,
      log_row.action,
      log_row.changes,
      log_row.created_at,
      live_task.id as live_task_id,
      live_task.committee_id as live_committee_id,
      live_event.name as live_event_name,
      live_committee.name as live_committee_name,
      actor.full_name as stored_actor_name,
      actor.anonymized_at as actor_anonymized_at
    from public.activity_log as log_row
    left join public.tasks as live_task
      on live_task.id = log_row.task_id
    left join public.events as live_event
      on live_event.id = live_task.event_id
    left join public.committees as live_committee
      on live_committee.id = live_task.committee_id
    left join public.users as actor
      on actor.id = log_row.user_id
    where (p_action is null or log_row.action = p_action)
      and (v_from is null or log_row.created_at >= v_from)
      and (v_until is null or log_row.created_at < v_until)
      and (p_task_id is null or log_row.task_id = p_task_id)
      and (
        p_cursor_created_at is null
        or (log_row.created_at, log_row.id)
           > (p_cursor_created_at, p_cursor_id)
      )
    order by log_row.created_at asc, log_row.id asc
    limit 2001;
  end if;

  loop
    fetch v_cursor into v_candidate;
    exit when not found;

    v_scanned := v_scanned + 1;
    if v_scanned = 2001 then
      v_candidate_overflow := true;
      exit;
    end if;
    v_last_created_at := v_candidate.created_at;
    v_last_id := v_candidate.id;

    v_snapshot := case v_candidate.action
      when 'UPDATE' then v_candidate.changes -> 'new'
      else v_candidate.changes
    end;
    v_old_snapshot := case v_candidate.action
      when 'UPDATE' then v_candidate.changes -> 'old'
      else null
    end;

    -- All historical generations contain these core fields. Later fields,
    -- including updated_at, are deliberately ignored whether present or not.
    v_snapshot_valid :=
      pg_catalog.jsonb_typeof(v_snapshot) = 'object'
      and pg_catalog.jsonb_typeof(v_snapshot -> 'id') = 'string'
      and pg_catalog.jsonb_typeof(v_snapshot -> 'event_id') = 'string'
      and pg_catalog.jsonb_typeof(v_snapshot -> 'committee_id') = 'string'
      and pg_catalog.jsonb_typeof(v_snapshot -> 'title') = 'string'
      and pg_catalog.jsonb_typeof(v_snapshot -> 'is_confidential') = 'boolean'
      and (v_snapshot ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (v_snapshot ->> 'event_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (v_snapshot ->> 'committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and pg_catalog.char_length(v_snapshot ->> 'title') between 1 and 1000
      and (
        v_candidate.action <> 'UPDATE'
        or (
          pg_catalog.jsonb_typeof(v_old_snapshot) = 'object'
          and pg_catalog.jsonb_typeof(v_old_snapshot -> 'id') = 'string'
          and pg_catalog.jsonb_typeof(v_old_snapshot -> 'event_id') = 'string'
          and pg_catalog.jsonb_typeof(v_old_snapshot -> 'committee_id') = 'string'
          and pg_catalog.jsonb_typeof(v_old_snapshot -> 'title') = 'string'
          and pg_catalog.jsonb_typeof(v_old_snapshot -> 'is_confidential') = 'boolean'
          and (v_old_snapshot ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and (v_old_snapshot ->> 'event_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and (v_old_snapshot ->> 'committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and pg_catalog.char_length(v_old_snapshot ->> 'title') between 1 and 1000
        )
      );

    v_row_masked := true;
    v_row_task_id := null;
    v_row_title := 'Confidential Task';
    v_row_event_name := null;
    v_row_committee_id := null;
    v_row_committee_name := null;
    v_row_actor_name := null;
    v_row_summary := null;

    if v_snapshot_valid then
      if v_candidate.live_task_id is not null then
        if public.task_content_access_for_user(
          v_candidate.live_task_id,
          v_caller_id
        ) = 'real' then
          v_row_masked := false;
          v_row_task_id := v_candidate.live_task_id;
          -- Historical titles intentionally come from the validated snapshot.
          -- Current access can therefore reveal an older title from when the
          -- same live task was confidential. Committee identity is current.
          v_row_title := v_snapshot ->> 'title';
          v_row_event_name := v_candidate.live_event_name;
          v_row_committee_id := v_candidate.live_committee_id;
          v_row_committee_name := v_candidate.live_committee_name;
        end if;
      elsif v_candidate.stored_task_id is not null
            and (v_snapshot ->> 'id')::uuid = v_candidate.stored_task_id then
        -- Orphan rows have no live task from which to recompute current access.
        -- Leadership may see a validated non-confidential snapshot only when
        -- every retained snapshot for the task proves it was never confidential.
        select
          coalesce(
            pg_catalog.bool_or(
              case sibling.action
                when 'UPDATE' then
                 sibling.changes -> 'old' -> 'is_confidential' = 'true'::jsonb
                 or sibling.changes -> 'new' -> 'is_confidential' = 'true'::jsonb
                else sibling.changes -> 'is_confidential' = 'true'::jsonb
              end
            ),
            false
          ),
          coalesce(
            pg_catalog.bool_or(
              case sibling.action
                when 'UPDATE' then
                  pg_catalog.jsonb_typeof(sibling.changes -> 'old') is distinct from 'object'
                  or pg_catalog.jsonb_typeof(sibling.changes -> 'new') is distinct from 'object'
                  or pg_catalog.jsonb_typeof(sibling.changes -> 'old' -> 'is_confidential') is distinct from 'boolean'
                  or pg_catalog.jsonb_typeof(sibling.changes -> 'new' -> 'is_confidential') is distinct from 'boolean'
                  or sibling.changes -> 'old' ->> 'id' is distinct from v_candidate.stored_task_id::text
                  or sibling.changes -> 'new' ->> 'id' is distinct from v_candidate.stored_task_id::text
                else
                  pg_catalog.jsonb_typeof(sibling.changes) is distinct from 'object'
                  or pg_catalog.jsonb_typeof(sibling.changes -> 'is_confidential') is distinct from 'boolean'
                  or sibling.changes ->> 'id' is distinct from v_candidate.stored_task_id::text
              end
            ),
            true
          )
        into v_orphan_has_confidential, v_orphan_evidence_invalid
        from public.activity_log as sibling
        where sibling.task_id = v_candidate.stored_task_id;

        select parent.name, parent.status
        into v_deleted_event_name, v_deleted_event_status
        from public.events as parent
        where parent.id = (v_snapshot ->> 'event_id')::uuid;

        v_orphan_parent_allowed :=
          not found or v_deleted_event_status in ('Active', 'Archived');

        if not v_orphan_has_confidential
           and not v_orphan_evidence_invalid
           and v_orphan_parent_allowed then
          v_row_masked := false;
          v_row_task_id := v_candidate.stored_task_id;
          v_row_title := v_snapshot ->> 'title';
          v_row_event_name := v_deleted_event_name;
          v_row_committee_id := (v_snapshot ->> 'committee_id')::uuid;

          select stored_committee.name
          into v_row_committee_name
          from public.committees as stored_committee
          where stored_committee.id = v_row_committee_id;
        end if;
      end if;
    end if;

    if not v_row_masked then
      v_row_actor_name := case
        when v_candidate.actor_anonymized_at is not null then 'Former member'
        when v_candidate.user_id is null
          or v_candidate.stored_actor_name is null then 'Unavailable actor'
        else v_candidate.stored_actor_name
      end;

      if v_candidate.action = 'INSERT' then
        v_row_summary := array['Task created']::text[];
      elsif v_candidate.action = 'DELETE' then
        v_row_summary := array['Task deleted']::text[];
      else
        v_row_summary := array[]::text[];
        if (v_old_snapshot -> 'title') is distinct from (v_snapshot -> 'title') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Title updated');
        end if;
        if (v_old_snapshot -> 'description') is distinct from (v_snapshot -> 'description') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Description updated');
        end if;
        if (v_old_snapshot -> 'phase') is distinct from (v_snapshot -> 'phase') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Phase updated');
        end if;
        if (v_old_snapshot -> 'status') is distinct from (v_snapshot -> 'status') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Status updated');
        end if;
        if (v_old_snapshot -> 'priority') is distinct from (v_snapshot -> 'priority') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Priority updated');
        end if;
        if (v_old_snapshot -> 'task_type') is distinct from (v_snapshot -> 'task_type')
           or (v_old_snapshot -> 'due_date') is distinct from (v_snapshot -> 'due_date')
           or (v_old_snapshot -> 'call_time') is distinct from (v_snapshot -> 'call_time')
           or (v_old_snapshot -> 'end_time') is distinct from (v_snapshot -> 'end_time') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Schedule updated');
        end if;
        if (v_old_snapshot -> 'primary_assignees') is distinct from (v_snapshot -> 'primary_assignees')
           or (v_old_snapshot -> 'assist_assignees') is distinct from (v_snapshot -> 'assist_assignees') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Assignments updated');
        end if;
        if (v_old_snapshot -> 'is_confidential') is distinct from (v_snapshot -> 'is_confidential')
           or (v_old_snapshot -> 'allowed_viewers') is distinct from (v_snapshot -> 'allowed_viewers') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Visibility updated');
        end if;
        if (v_old_snapshot -> 'request_backup') is distinct from (v_snapshot -> 'request_backup') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Backup request updated');
        end if;
        if (v_old_snapshot -> 'depends_on_task_id') is distinct from (v_snapshot -> 'depends_on_task_id') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Dependency updated');
        end if;
        if (v_old_snapshot -> 'event_id') is distinct from (v_snapshot -> 'event_id')
           or (v_old_snapshot -> 'committee_id') is distinct from (v_snapshot -> 'committee_id') then
          v_row_summary := pg_catalog.array_append(v_row_summary, 'Ownership updated');
        end if;
        if pg_catalog.cardinality(v_row_summary) = 0 then
          v_row_summary := array['Task updated']::text[];
        end if;
      end if;
    end if;

    -- Action/date/cursor/task filters ran before access evaluation. Masked rows
    -- remain eligible for action/date filters, but committee or search filters
    -- always exclude them so hidden values cannot become an oracle.
    if p_committee_id is not null
       and (v_row_masked or v_row_committee_id is distinct from p_committee_id) then
      continue;
    end if;

    v_action_label := case v_candidate.action
      when 'INSERT' then 'Created'
      when 'UPDATE' then 'Updated'
      when 'DELETE' then 'Deleted'
    end;

    if v_search <> '' and (
      v_row_masked
      or not (
        pg_catalog.strpos(pg_catalog.lower(coalesce(v_row_actor_name, '')), pg_catalog.lower(v_search)) > 0
        or pg_catalog.strpos(pg_catalog.lower(v_action_label), pg_catalog.lower(v_search)) > 0
        or pg_catalog.strpos(pg_catalog.lower(coalesce(v_row_title, '')), pg_catalog.lower(v_search)) > 0
        or pg_catalog.strpos(pg_catalog.lower(coalesce(v_row_event_name, '')), pg_catalog.lower(v_search)) > 0
        or pg_catalog.strpos(pg_catalog.lower(coalesce(v_row_committee_name, '')), pg_catalog.lower(v_search)) > 0
      )
    ) then
      continue;
    end if;

    v_match_count := v_match_count + 1;
    v_results := v_results || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'activity_id', v_candidate.id,
        'activity_created_at', v_candidate.created_at,
        'action', v_candidate.action,
        'task_id', v_row_task_id,
        'task_title', v_row_title,
        'event_name', v_row_event_name,
        'committee_id', v_row_committee_id,
        'committee_name', v_row_committee_name,
        'actor_name', v_row_actor_name,
        'change_summary', v_row_summary,
        'is_masked', v_row_masked
      )
    );

    exit when v_match_count = p_page_size + 1;
  end loop;

  close v_cursor;

  if v_match_count > p_page_size then
    -- A 21st safe match exists: continue after the last returned row.
    v_has_more := true;
    v_entry := v_results -> (p_page_size - 1);
    v_next_created_at := (v_entry ->> 'activity_created_at')::timestamptz;
    v_next_id := (v_entry ->> 'activity_id')::uuid;
  elsif v_candidate_overflow then
    -- Scan cap reached with fewer than 21 matches: return what was found and
    -- continue after the last scanned candidate. A page may be short or empty.
    v_has_more := true;
    v_next_created_at := v_last_created_at;
    v_next_id := v_last_id;
  end if;

  -- Clients must ignore rows with a null activity_id as activities.
  if v_match_count = 0 and v_has_more then
    return query
    select
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
      when pg_catalog.jsonb_typeof(entry.value -> 'change_summary') = 'array'
      then array(
        select pg_catalog.jsonb_array_elements_text(
          entry.value -> 'change_summary'
        )
      )
      else null::text[]
    end,
    (entry.value ->> 'is_masked')::boolean,
    v_has_more,
    v_next_created_at,
    v_next_id
  from pg_catalog.jsonb_array_elements(v_results) with ordinality as entry(value, position)
  where entry.position <= p_page_size
  order by entry.position;
end;
$$;

alter function public.list_activity_log(
  uuid, text, text, uuid, date, date, text, timestamptz, uuid, integer
) owner to postgres;

revoke all on function public.list_activity_log(
  uuid, text, text, uuid, date, date, text, timestamptz, uuid, integer
) from public, anon, authenticated;

grant execute on function public.list_activity_log(
  uuid, text, text, uuid, date, date, text, timestamptz, uuid, integer
) to authenticated;


do $$
declare
  v_role record;
  v_has_membership_options boolean;
  v_membership_count integer;
  v_valid_membership_count integer;
begin
  select
    role_row.rolcanlogin,
    role_row.rolinherit,
    role_row.rolsuper,
    role_row.rolcreaterole,
    role_row.rolcreatedb,
    role_row.rolreplication,
    role_row.rolbypassrls
  into v_role
  from pg_catalog.pg_roles as role_row
  where role_row.rolname = 'ceit_event_delete_executor';

  if not found
     or v_role.rolcanlogin
     or v_role.rolinherit
     or v_role.rolsuper
     or v_role.rolcreaterole
     or v_role.rolcreatedb
     or v_role.rolreplication
     or v_role.rolbypassrls then
    raise exception 'ceit_event_delete_executor has unsafe role attributes.';
  end if;

  select pg_catalog.count(*) = 2
  into v_has_membership_options
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'pg_catalog.pg_auth_members'::regclass
    and attribute.attname in ('inherit_option', 'set_option')
    and not attribute.attisdropped;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where membership.roleid = 'ceit_event_delete_executor'::regrole
        and membership.member = 'postgres'::regrole
        and membership.admin_option is true
        and (pg_catalog.to_jsonb(membership) ->> 'inherit_option')::boolean is false
        and (pg_catalog.to_jsonb(membership) ->> 'set_option')::boolean is false
    )::integer
  into v_membership_count, v_valid_membership_count
  from pg_catalog.pg_auth_members as membership
  where membership.roleid = 'ceit_event_delete_executor'::regrole
     or membership.member = 'ceit_event_delete_executor'::regrole;

  if (
    v_has_membership_options
    and (v_membership_count <> 1 or v_valid_membership_count <> 1)
  ) or (
    not v_has_membership_options
    and v_membership_count <> 0
  ) then
    raise exception 'ceit_event_delete_executor has unsafe role memberships.';
  end if;
end
$$;

create schema if not exists ceit_connect_private authorization postgres;
revoke all on schema ceit_connect_private from public, anon, authenticated, service_role;

create table ceit_connect_private.event_delete_cascade_context (
  transaction_id xid8 primary key,
  event_id uuid not null,
  actor_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table ceit_connect_private.event_delete_cascade_context enable row level security;
revoke all on table ceit_connect_private.event_delete_cascade_context
from public, anon, authenticated, service_role;
grant usage on schema ceit_connect_private to ceit_event_delete_executor;
grant select, insert, delete
on table ceit_connect_private.event_delete_cascade_context
to ceit_event_delete_executor;

create policy event_delete_context_executor_select
on ceit_connect_private.event_delete_cascade_context
for select to ceit_event_delete_executor
using (true);

create policy event_delete_context_executor_insert
on ceit_connect_private.event_delete_cascade_context
for insert to ceit_event_delete_executor
with check (true);

create policy event_delete_context_executor_delete
on ceit_connect_private.event_delete_cascade_context
for delete to ceit_event_delete_executor
using (true);

create function ceit_connect_private.event_delete_context_matches(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_event_id is not null
    and exists (
      select 1
      from ceit_connect_private.event_delete_cascade_context as context_row
      where context_row.transaction_id = pg_catalog.pg_current_xact_id()
        and context_row.event_id = p_event_id
    );
$$;

alter function ceit_connect_private.event_delete_context_matches(uuid)
owner to postgres;
revoke all on function ceit_connect_private.event_delete_context_matches(uuid)
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create function ceit_connect_private.event_delete_actor_id(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select context_row.actor_id
  from ceit_connect_private.event_delete_cascade_context as context_row
  where context_row.transaction_id = pg_catalog.pg_current_xact_id()
    and context_row.event_id = p_event_id;
$$;

alter function ceit_connect_private.event_delete_actor_id(uuid) owner to postgres;
revoke all on function ceit_connect_private.event_delete_actor_id(uuid)
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create function ceit_connect_private.event_delete_actor_is_active_admin(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_actor_id is not null
    and exists (
      select 1
      from public.users as actor
      where actor.id = p_actor_id
        and actor.is_active is true
        and actor.role = 'Admin'
    );
$$;

alter function ceit_connect_private.event_delete_actor_is_active_admin(uuid)
owner to postgres;
revoke all on function ceit_connect_private.event_delete_actor_is_active_admin(uuid)
from public, anon, authenticated, service_role;
grant execute on function ceit_connect_private.event_delete_actor_is_active_admin(uuid)
to ceit_event_delete_executor;

-- The FK inventory is deliberately exact. The generic locker below refuses to
-- delete when a future FK references events or tasks without being reviewed.
create table ceit_connect_private.event_delete_fk_lock_list (
  constraint_name name primary key,
  referencing_schema name not null,
  referencing_table name not null,
  referenced_table name not null,
  lock_kind text not null check (lock_kind in ('task_rows', 'task_child_rows')),
  lock_order integer not null unique
);

insert into ceit_connect_private.event_delete_fk_lock_list (
  constraint_name,
  referencing_schema,
  referencing_table,
  referenced_table,
  lock_kind,
  lock_order
)
values
  ('tasks_event_id_fkey', 'public', 'tasks', 'events', 'task_rows', 10),
  ('tasks_depends_on_task_id_fkey', 'public', 'tasks', 'tasks', 'task_rows', 20),
  ('task_work_links_task_id_fkey', 'public', 'task_work_links', 'tasks', 'task_child_rows', 30),
  ('task_volunteers_task_id_fkey', 'public', 'task_volunteers', 'tasks', 'task_child_rows', 40),
  ('task_comments_task_id_fkey', 'public', 'task_comments', 'tasks', 'task_child_rows', 50),
  ('archived_task_viewers_task_id_fkey', 'public', 'archived_task_viewers', 'tasks', 'task_child_rows', 60),
  ('notifications_task_id_fkey', 'public', 'notifications', 'tasks', 'task_child_rows', 70),
  ('task_leave_requests_task_id_fkey', 'public', 'task_leave_requests', 'tasks', 'task_child_rows', 80);

revoke all on table ceit_connect_private.event_delete_fk_lock_list
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create function ceit_connect_private.lock_event_delete_descendants(p_event_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_ids uuid[];
  v_task_id uuid;
  v_fk record;
  v_fk_column name;
  v_expected_count integer;
  v_actual_count integer;
begin
  if not ceit_connect_private.event_delete_context_matches(p_event_id) then
    raise exception using
      errcode = 'CCE08',
      message = 'The event deletion context is unavailable.';
  end if;

  select pg_catalog.count(*)::integer
  into v_expected_count
  from ceit_connect_private.event_delete_fk_lock_list;

  select pg_catalog.count(*)::integer
  into v_actual_count
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid in ('public.events'::regclass, 'public.tasks'::regclass);

  if v_actual_count <> v_expected_count
     or exists (
       select
         constraint_row.conname,
         source_namespace.nspname,
         source_class.relname,
         target_class.relname
       from pg_catalog.pg_constraint as constraint_row
       join pg_catalog.pg_class as source_class
         on source_class.oid = constraint_row.conrelid
       join pg_catalog.pg_namespace as source_namespace
         on source_namespace.oid = source_class.relnamespace
       join pg_catalog.pg_class as target_class
         on target_class.oid = constraint_row.confrelid
       where constraint_row.contype = 'f'
         and constraint_row.confrelid in ('public.events'::regclass, 'public.tasks'::regclass)
       except
       select
         lock_row.constraint_name,
         lock_row.referencing_schema,
         lock_row.referencing_table,
         lock_row.referenced_table
       from ceit_connect_private.event_delete_fk_lock_list as lock_row
     ) then
    raise exception using
      errcode = 'CCE09',
      message = 'Event deletion stopped because its foreign-key lock inventory is incomplete.';
  end if;

  v_task_ids := '{}'::uuid[];
  begin
    for v_task_id in
      select stored_task.id
      from public.tasks as stored_task
      where stored_task.event_id = p_event_id
      order by stored_task.id
      for update nowait
    loop
      v_task_ids := pg_catalog.array_append(v_task_ids, v_task_id);
    end loop;
  exception
    when lock_not_available or deadlock_detected then
      raise exception using
        errcode = 'CCE06',
        message = 'The event is busy. Wait for current task changes to finish, then retry.';
  end;

  for v_fk in
    select
      constraint_row.oid,
      constraint_row.conrelid,
      source_namespace.nspname as source_schema,
      source_class.relname as source_table,
      constraint_row.conkey,
      lock_row.lock_order
    from ceit_connect_private.event_delete_fk_lock_list as lock_row
    join pg_catalog.pg_constraint as constraint_row
      on constraint_row.conname = lock_row.constraint_name
    join pg_catalog.pg_class as source_class
      on source_class.oid = constraint_row.conrelid
     and source_class.relname = lock_row.referencing_table
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_class.relnamespace
     and source_namespace.nspname = lock_row.referencing_schema
    where lock_row.lock_kind = 'task_child_rows'
    order by lock_row.lock_order
  loop
    if pg_catalog.cardinality(v_fk.conkey) <> 1 then
      raise exception using
        errcode = 'CCE09',
        message = 'Event deletion stopped because a child foreign key is not single-column.';
    end if;

    select attribute.attname
    into v_fk_column
    from pg_catalog.pg_attribute as attribute
    where attribute.attrelid = v_fk.conrelid
      and attribute.attnum = v_fk.conkey[1];

    if v_fk_column is null then
      raise exception using
        errcode = 'CCE09',
        message = 'Event deletion stopped because a child lock column is unavailable.';
    end if;

    begin
      execute pg_catalog.format(
        'select 1 from %I.%I as child_row where child_row.%I = any ($1) '
        || 'order by child_row.%I, child_row.ctid for update nowait',
        v_fk.source_schema,
        v_fk.source_table,
        v_fk_column,
        v_fk_column
      )
      using v_task_ids;
    exception
      when lock_not_available or deadlock_detected then
        raise exception using
          errcode = 'CCE06',
          message = 'The event is busy. Wait for current task changes to finish, then retry.';
    end;
  end loop;
end;
$$;

alter function ceit_connect_private.lock_event_delete_descendants(uuid)
owner to postgres;
revoke all on function ceit_connect_private.lock_event_delete_descendants(uuid)
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create function public.event_cleanup_object_path_is_valid(
  p_event_id uuid,
  p_bucket_id text,
  p_object_path text
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_event_id is not null
    and p_bucket_id = 'banners'
    and p_object_path ~* (
      '^' || p_event_id::text || '/'
      || '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
    );
$$;

alter function public.event_cleanup_object_path_is_valid(uuid, text, text)
owner to postgres;
revoke all on function public.event_cleanup_object_path_is_valid(uuid, text, text)
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create table public.event_storage_cleanup_jobs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  bucket_id text not null,
  object_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'done', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  claim_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  constraint event_storage_cleanup_jobs_object_valid
    check (public.event_cleanup_object_path_is_valid(event_id, bucket_id, object_path)),
  constraint event_storage_cleanup_jobs_object_unique
    unique (bucket_id, object_path),
  constraint event_storage_cleanup_jobs_claim_shape
    check ((claim_token is null) = (lease_expires_at is null)),
  constraint event_storage_cleanup_jobs_attempt_shape
    check (
      (attempt_count = 0 and last_attempt_at is null)
      or (attempt_count > 0 and last_attempt_at is not null)
    ),
  constraint event_storage_cleanup_jobs_error_shape
    check (
      last_error is null
      or (
        pg_catalog.char_length(last_error) between 1 and 200
        and last_error !~ '[[:cntrl:]]'
      )
    ),
  constraint event_storage_cleanup_jobs_state_shape
    check (
      (status = 'done' and completed_at is not null and claim_token is null and last_error is null)
      or (status = 'pending' and completed_at is null and last_error is null)
      or (status = 'failed' and completed_at is null and last_error is not null)
    )
);

create index event_storage_cleanup_jobs_retry_idx
on public.event_storage_cleanup_jobs (status, lease_expires_at, created_at, id)
where status in ('pending', 'failed');

alter table public.event_storage_cleanup_jobs enable row level security;
revoke all on table public.event_storage_cleanup_jobs
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create function public.count_event_storage_cleanup_jobs()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
  from public.event_storage_cleanup_jobs as job
  where job.status in ('pending', 'failed');
$$;

alter function public.count_event_storage_cleanup_jobs() owner to postgres;
revoke all on function public.count_event_storage_cleanup_jobs()
from public, anon, authenticated;
grant execute on function public.count_event_storage_cleanup_jobs() to service_role;

create function public.claim_event_storage_cleanup_job(p_job_id uuid default null)
returns table (
  out_job_id uuid,
  out_event_id uuid,
  out_bucket_id text,
  out_object_path text,
  out_claim_token uuid,
  out_lease_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  return query
  with candidate as materialized (
    select job.id
    from public.event_storage_cleanup_jobs as job
    where (
        job.status = 'pending'
        or (
          job.status = 'failed'
          and job.last_attempt_at <= v_now - interval '1 minute'
        )
      )
      and (p_job_id is null or job.id = p_job_id)
      and (job.claim_token is null or job.lease_expires_at <= v_now)
    order by job.last_attempt_at nulls first, job.created_at, job.id
    limit 1
    for update of job skip locked
  )
  update public.event_storage_cleanup_jobs as job
  set
    attempt_count = job.attempt_count + 1,
    claim_token = gen_random_uuid(),
    lease_expires_at = v_now + interval '5 minutes',
    last_attempt_at = v_now,
    updated_at = v_now
  from candidate
  where job.id = candidate.id
  returning
    job.id,
    job.event_id,
    job.bucket_id,
    job.object_path,
    job.claim_token,
    job.lease_expires_at;
end;
$$;

alter function public.claim_event_storage_cleanup_job(uuid) owner to postgres;
revoke all on function public.claim_event_storage_cleanup_job(uuid)
from public, anon, authenticated;
grant execute on function public.claim_event_storage_cleanup_job(uuid) to service_role;

create function public.finalize_event_storage_cleanup_job(
  p_job_id uuid,
  p_claim_token uuid,
  p_outcome text,
  p_last_error text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_error text;
  v_updated integer;
begin
  if p_job_id is null
     or p_claim_token is null
     or p_outcome is null
     or p_outcome not in ('done', 'failed') then
    raise exception using
      errcode = 'CCE10',
      message = 'The cleanup result is invalid.';
  end if;

  if p_outcome = 'done' then
    if p_last_error is not null then
      raise exception using
        errcode = 'CCE10',
        message = 'A completed cleanup cannot store an error.';
    end if;
    v_error := null;
  else
    v_error := pg_catalog.btrim(coalesce(p_last_error, ''));
    if v_error = ''
       or pg_catalog.char_length(v_error) > 200
       or v_error ~ '[[:cntrl:]]' then
      raise exception using
        errcode = 'CCE10',
        message = 'The cleanup error is invalid.';
    end if;
  end if;

  update public.event_storage_cleanup_jobs as job
  set
    status = p_outcome,
    claim_token = null,
    lease_expires_at = null,
    last_error = v_error,
    completed_at = case when p_outcome = 'done' then v_now else null end,
    updated_at = v_now
  where job.id = p_job_id
    and job.claim_token = p_claim_token
    and job.lease_expires_at > v_now;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

alter function public.finalize_event_storage_cleanup_job(uuid, uuid, text, text)
owner to postgres;
revoke all on function public.finalize_event_storage_cleanup_job(uuid, uuid, text, text)
from public, anon, authenticated;
grant execute on function public.finalize_event_storage_cleanup_job(uuid, uuid, text, text)
to service_role;

-- Only the RPC may initiate an event deletion. Raw browser and service-role
-- DELETE loses both its policy and table privilege.
drop policy if exists events_delete on public.events;
revoke delete on table public.events from public, anon, authenticated, service_role;

-- Keep only task UUID values; existing nulls remain null and are not rebuilt.
alter table public.activity_log
drop constraint activity_log_task_id_fkey;

create index if not exists activity_log_task_id_idx
on public.activity_log (task_id, created_at, id)
where task_id is not null;

create or replace function public.guard_event_updates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if TG_OP = 'DELETE' then
    if not ceit_connect_private.event_delete_context_matches(old.id) then
      raise exception using
        errcode = 'CCE01',
        message = 'Events can be deleted only through the event deletion service.';
    end if;

    if old.status not in ('Draft', 'Archived') then
      raise exception using
        errcode = 'CCE04',
        message = 'Only Draft or Archived events can be deleted.';
    end if;

    delete from public.tasks
    where event_id = old.id;

    return old;
  end if;

  if old.status = 'Archived' then
    raise exception 'Archived events are read-only.';
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'An event''s created_by cannot be changed.';
  end if;

  if old.status = 'Active' and new.status = 'Draft' then
    raise exception 'An Active event cannot be changed back to Draft.';
  end if;

  if new.status = 'Archived' and old.status <> 'Active' then
    raise exception 'Only Active events can be archived.';
  end if;

  if old.status = 'Draft' and new.status = 'Active' then
    if new.end_date is null then
      raise exception 'An Active event requires an end date.';
    end if;

    if not exists (
      select 1
      from public.tasks
      where event_id = old.id
    ) then
      raise exception 'An event requires at least one task before it can be launched.';
    end if;
  end if;

  return new;
end;
$$;

alter function public.guard_event_updates() owner to postgres;
revoke all on function public.guard_event_updates()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.guard_archived_event_task_writes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent_ids uuid[];
  v_parent_id uuid;
  v_locked_parent_count integer := 0;
begin
  if TG_OP = 'DELETE'
     and ceit_connect_private.event_delete_context_matches(old.event_id) then
    return old;
  end if;

  if TG_OP = 'INSERT' then
    v_parent_ids := array[new.event_id];
  elsif TG_OP = 'DELETE' then
    v_parent_ids := array[old.event_id];
  else
    select pg_catalog.array_agg(parent_id order by parent_id)
    into v_parent_ids
    from (
      select distinct parent_id
      from pg_catalog.unnest(array[old.event_id, new.event_id]) as parents(parent_id)
    ) as distinct_parents;
  end if;

  for v_parent_id in
    select event_row.id
    from public.events as event_row
    where event_row.id = any(v_parent_ids)
    order by event_row.id
    for share
  loop
    v_locked_parent_count := v_locked_parent_count + 1;
  end loop;

  if v_locked_parent_count <> pg_catalog.cardinality(v_parent_ids) then
    raise exception 'Task write rejected because its parent event could not be verified.';
  end if;

  if exists (
    select 1
    from public.events as event_row
    where event_row.id = any(v_parent_ids)
      and event_row.status = 'Archived'
  ) then
    raise exception 'Tasks in Archived events are read-only.';
  end if;

  if TG_OP = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function public.guard_archived_event_task_writes() owner to postgres;
revoke all on function public.guard_archived_event_task_writes()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.guard_referenced_prerequisite_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.pg_trigger_depth() > 1
     and ceit_connect_private.event_delete_context_matches(old.event_id) then
    return old;
  end if;

  if exists (
    select 1
    from public.tasks as dependent
    where dependent.depends_on_task_id = old.id
  ) then
    raise exception using
      errcode = 'CCD01',
      message = 'This task cannot be deleted because another task depends on it.';
  end if;
  return old;
end;
$$;

alter function public.guard_referenced_prerequisite_deletion() owner to postgres;
revoke all on function public.guard_referenced_prerequisite_deletion()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.guard_task_work_link_writes()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_task_id uuid := case when TG_OP='INSERT' then new.task_id else old.task_id end;
  v_event_id uuid; v_event_status text; v_primary_assignees uuid[];
  v_assist_assignees uuid[]; v_caller_role text; v_link_count integer;
begin
  if TG_OP='DELETE' and pg_catalog.pg_trigger_depth()>1
     and exists (
       select 1
       from ceit_connect_private.event_delete_cascade_context as context_row
       where context_row.transaction_id=pg_catalog.pg_current_xact_id()
     )
     and not exists (
       select 1 from public.tasks as task_row where task_row.id=old.task_id
     ) then return old; end if;
  if public.draft_task_write_allowed_for_user(v_task_id,auth.uid()) is not true then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  select task_row.event_id,task_row.primary_assignees,task_row.assist_assignees
  into v_event_id,v_primary_assignees,v_assist_assignees
  from public.tasks as task_row where task_row.id=v_task_id for no key update;
  if not found then raise exception using errcode='CCL02',message='Task not found.'; end if;
  select event_row.status into v_event_status from public.events as event_row
  where event_row.id=v_event_id for share;
  if not found then raise exception using errcode='CCL02',message='The task parent event could not be verified.'; end if;
  if not exists(
    select 1 from public.tasks as task_row
    join public.events as event_row on event_row.id=task_row.event_id
    where task_row.id=v_task_id and task_row.event_id=v_event_id
      and event_row.status=v_event_status
  ) then
    raise exception using errcode='CCL02',message='The task parent event changed during the work-link write.';
  end if;
  if public.draft_task_write_allowed_for_user(v_task_id,auth.uid()) is not true then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  if v_event_status='Archived' then
    raise exception using errcode='CCL03',message='Work links in Archived events are read-only.';
  end if;
  select user_row.role into v_caller_role from public.users as user_row
  where user_row.id=auth.uid() and user_row.is_active is true;
  if not found or public.task_content_access(v_task_id)<>'real' then
    raise exception using errcode='42501',message='Work-link access is not allowed.';
  end if;
  if TG_OP='INSERT' then
    if not coalesce(auth.uid()=any(v_primary_assignees),false)
       and not coalesce(auth.uid()=any(v_assist_assignees),false) then
      raise exception using errcode='42501',message='Only an active task assignee can add work links.';
    end if;
    select pg_catalog.count(*) into v_link_count from public.task_work_links as link_row
    where link_row.task_id=v_task_id;
    if v_link_count>=20 then
      raise exception using errcode='CCL04',message='A task can have at most 20 work links.';
    end if;
    new.created_by:=auth.uid(); return new;
  end if;
  if old.created_by is distinct from auth.uid()
     and v_caller_role not in ('Admin','Co-Admin') then
    raise exception using errcode='42501',message='Only the link creator, an active Admin, or an active Co-Admin can remove this work link.';
  end if;
  return old;
end $$;

alter function public.guard_task_work_link_writes() owner to postgres;
revoke all on function public.guard_task_work_link_writes()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.guard_task_comment_writes()
returns trigger language plpgsql volatile security definer set search_path=''
as $$
declare
  v_caller_id uuid:=auth.uid(); v_caller_role text;
  v_task_id uuid:=case when TG_OP='INSERT' then new.task_id else old.task_id end;
  v_event_id uuid; v_event_status text; v_body text; v_mentions uuid[];
begin
  if TG_OP='UPDATE' and new.task_id is distinct from old.task_id then
    raise exception using errcode='CCC10',message='A comment cannot be moved to another task.';
  end if;
  if TG_OP='DELETE' and pg_catalog.pg_trigger_depth()>1
     and exists (
       select 1
       from ceit_connect_private.event_delete_cascade_context as context_row
       where context_row.transaction_id=pg_catalog.pg_current_xact_id()
     )
     and not exists (
       select 1 from public.tasks as task_row where task_row.id=old.task_id
     ) then return old; end if;
  if public.draft_task_write_allowed_for_user(v_task_id,v_caller_id) is not true then
    raise exception using errcode='CCC01',message='The task comments are unavailable.';
  end if;
  select task_row.event_id into v_event_id from public.tasks as task_row
  where task_row.id=v_task_id for no key update;
  if not found then
    raise exception using errcode='40001',message='The comment task changed. Refresh and try again.';
  end if;
  select event_row.status into v_event_status from public.events as event_row
  where event_row.id=v_event_id for share;
  if not found or not exists(
    select 1 from public.tasks as task_row
    where task_row.id=v_task_id and task_row.event_id=v_event_id
  ) then
    raise exception using errcode='40001',message='The comment task changed. Refresh and try again.';
  end if;
  if public.draft_task_write_allowed_for_user(v_task_id,v_caller_id) is not true then
    raise exception using errcode='CCC01',message='The task comments are unavailable.';
  end if;
  if public.task_content_access(v_task_id)<>'real' then
    raise exception using errcode='CCC01',message='The task comments are unavailable.';
  end if;
  if v_event_status='Archived' then
    raise exception using errcode='CCC05',message='Archived task comments are read-only.';
  end if;
  select user_row.role into v_caller_role from public.users as user_row
  where user_row.id=v_caller_id and user_row.is_active is true;
  if not found then raise exception using errcode='CCC01',message='The task comments are unavailable.'; end if;
  if TG_OP='DELETE' then
    if old.created_by is distinct from v_caller_id and v_caller_role<>'Admin' then
      raise exception using errcode='CCC07',message='You cannot delete this comment.';
    end if;
    return old;
  end if;
  v_body:=public.task_comment_trim_body(new.body);
  if v_body is null or pg_catalog.char_length(v_body) not between 1 and 4000
     or new.is_heads_up is null then
    raise exception using errcode='CCC03',message='A comment must contain between 1 and 4000 characters.';
  end if;
  v_mentions:=public.normalize_task_comment_mentions(new.mentioned_user_ids);
  if public.task_comment_mentions_are_valid(v_task_id,v_mentions) is not true then
    raise exception using errcode='CCC04',message='Every mentioned user must be an available active user with full task access.';
  end if;
  new.body:=v_body; new.mentioned_user_ids:=v_mentions;
  if TG_OP='INSERT' then
    new.created_by:=v_caller_id; new.created_at:=pg_catalog.clock_timestamp();
    new.edited_at:=null; return new;
  end if;
  if old.created_by is distinct from v_caller_id then
    raise exception using errcode='CCC06',message='Only the comment author can edit it.';
  end if;
  if (new.id,new.task_id,new.created_by,new.created_at)
     is distinct from (old.id,old.task_id,old.created_by,old.created_at) then
    raise exception using errcode='CCC10',message='Comment identity and creation fields are immutable.';
  end if;
  if (new.body,new.is_heads_up,new.mentioned_user_ids)
     is not distinct from (old.body,old.is_heads_up,old.mentioned_user_ids) then
    raise exception using errcode='CCC09',message='Make a change before saving the comment.';
  end if;
  new.edited_at:=pg_catalog.clock_timestamp(); return new;
end $$;

alter function public.guard_task_comment_writes() owner to postgres;
revoke all on function public.guard_task_comment_writes()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.guard_task_volunteer_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_id uuid := case when TG_OP = 'INSERT' then new.task_id else old.task_id end;
  v_event_id uuid;
  v_event_status text;
begin
  if TG_OP = 'UPDATE' then
    raise exception using
      errcode = 'CCB09',
      message = 'Volunteer offers cannot be updated; task_id is immutable.';
  end if;

  select task_row.event_id
  into v_event_id
  from public.tasks as task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    if TG_OP = 'DELETE'
       and pg_catalog.pg_trigger_depth() > 1
       and exists (
         select 1
         from ceit_connect_private.event_delete_cascade_context as context_row
         where context_row.transaction_id = pg_catalog.pg_current_xact_id()
       ) then
      return old;
    end if;
    raise exception using
      errcode = 'CCB01',
      message = 'The volunteer task is unavailable.';
  end if;

  select event_row.status
  into v_event_status
  from public.events as event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1
    from public.tasks as task_row
    where task_row.id = v_task_id
      and task_row.event_id = v_event_id
  ) then
    raise exception using
      errcode = '40001',
      message = 'The volunteer task changed. Refresh and try again.';
  end if;

  if v_event_status = 'Archived' then
    raise exception using
      errcode = 'CCB08',
      message = 'Volunteer offers in Archived events are read-only.';
  end if;
  if TG_OP = 'INSERT' and v_event_status <> 'Active' then
    raise exception using
      errcode = 'CCB02',
      message = 'Volunteer offers are available only for Active events.';
  end if;
  if TG_OP = 'INSERT' then return new; end if;
  return old;
end;
$$;

alter function public.guard_task_volunteer_writes() owner to postgres;
revoke all on function public.guard_task_volunteer_writes()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.guard_archived_task_viewer_writes()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_task_id uuid := case when TG_OP = 'INSERT' then new.task_id else old.task_id end;
  v_event_id uuid;
  v_event_status text;
begin
  if TG_OP = 'UPDATE' then
    raise exception using
      errcode = 'CCS07',
      message = 'Archive-only task shares cannot be updated.';
  end if;

  select task_row.event_id
  into v_event_id
  from public.tasks as task_row
  where task_row.id = v_task_id
  for no key update;

  if not found then
    if TG_OP = 'DELETE'
       and pg_catalog.pg_trigger_depth() > 1
       and exists (
         select 1
         from ceit_connect_private.event_delete_cascade_context as context_row
         where context_row.transaction_id = pg_catalog.pg_current_xact_id()
       ) then
      return old;
    end if;
    raise exception using
      errcode = 'CCS02',
      message = 'Archive-only sharing is unavailable for this task.';
  end if;

  select event_row.status
  into v_event_status
  from public.events as event_row
  where event_row.id = v_event_id
  for share;

  if not found or not exists (
    select 1
    from public.tasks as task_row
    where task_row.id = v_task_id
      and task_row.event_id = v_event_id
  ) then
    raise exception using
      errcode = '40001',
      message = 'The task changed. Refresh and try again.';
  end if;

  if v_event_status <> 'Archived' then
    raise exception using
      errcode = 'CCS02',
      message = 'Archive-only sharing is unavailable for this task.';
  end if;
  if TG_OP = 'INSERT' then
    new.granted_by := auth.uid(); return new;
  end if;
  return old;
end;
$$;

alter function public.guard_archived_task_viewer_writes() owner to postgres;
revoke all on function public.guard_archived_task_viewer_writes()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.enforce_active_event_has_tasks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid;
  v_event_status text;
begin
  if TG_TABLE_SCHEMA = 'public' and TG_TABLE_NAME = 'events' and TG_OP = 'INSERT' then
    v_event_id := new.id;
  elsif TG_TABLE_SCHEMA = 'public'
        and TG_TABLE_NAME = 'tasks'
        and TG_OP in ('DELETE', 'UPDATE') then
    v_event_id := old.event_id;
  else
    raise exception 'Active-event task invariant invoked for an unsupported operation.';
  end if;

  select event_row.status
  into v_event_status
  from public.events as event_row
  where event_row.id = v_event_id
  for update;

  if not found then
    if TG_TABLE_NAME = 'tasks'
       and TG_OP = 'DELETE'
       and ceit_connect_private.event_delete_context_matches(v_event_id) then
      return old;
    end if;
    raise exception 'Active-event task invariant could not verify the event.';
  end if;

  if v_event_status = 'Active'
     and not exists (
       select 1
       from public.tasks as task_row
       where task_row.event_id = v_event_id
     ) then
    raise exception 'An Active event must have at least one task.';
  end if;
  if TG_OP = 'DELETE' then return old; end if;
  return new;
end;
$$;

alter function public.enforce_active_event_has_tasks() owner to postgres;
revoke all on function public.enforce_active_event_has_tasks()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (task_id, user_id, action, changes)
    values (new.id, auth.uid(), 'INSERT', pg_catalog.to_jsonb(new) - 'updated_at');
  elsif tg_op = 'UPDATE' then
    if (pg_catalog.to_jsonb(new) - 'sort_order' - 'updated_at') is distinct from
       (pg_catalog.to_jsonb(old) - 'sort_order' - 'updated_at') then
      insert into public.activity_log (task_id, user_id, action, changes)
      values (
        new.id,
        auth.uid(),
        'UPDATE',
        pg_catalog.jsonb_build_object(
          'old', pg_catalog.to_jsonb(old) - 'updated_at',
          'new', pg_catalog.to_jsonb(new) - 'updated_at'
        )
      );
    end if;
  elsif tg_op = 'DELETE' then
    v_actor_id := coalesce(
      auth.uid(),
      ceit_connect_private.event_delete_actor_id(old.event_id)
    );
    insert into public.activity_log (task_id, user_id, action, changes)
    values (
      old.id,
      v_actor_id,
      'DELETE',
      pg_catalog.to_jsonb(old) - 'updated_at'
    );
  end if;
  return coalesce(new, old);
end;
$$;

alter function public.log_task_activity() owner to postgres;
revoke all on function public.log_task_activity()
from public, anon, authenticated, service_role, ceit_event_delete_executor;

create function ceit_connect_private.perform_event_delete(
  p_event_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  out_event_id uuid,
  out_cleanup_job_id uuid,
  out_cleanup_unavailable boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_updated_at timestamptz;
  v_banner_url text;
  v_banner_file text;
  v_object_path text;
  v_cleanup_job_id uuid;
  v_cleanup_unavailable boolean := false;
  v_deleted integer;
begin
  if not ceit_connect_private.event_delete_context_matches(p_event_id) then
    raise exception using
      errcode = 'CCE08',
      message = 'The event deletion context is unavailable.';
  end if;

  select event_row.status, event_row.updated_at, event_row.banner_url
  into v_status, v_updated_at, v_banner_url
  from public.events as event_row
  where event_row.id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'CCE03', message = 'The event is unavailable.';
  end if;

  -- Event row -> dependency advisory -> task rows -> generic child rows.
  perform pg_catalog.pg_advisory_xact_lock(public.task_dependency_lock_key(p_event_id));

  select event_row.status, event_row.updated_at, event_row.banner_url
  into v_status, v_updated_at, v_banner_url
  from public.events as event_row
  where event_row.id = p_event_id;

  if not found then
    raise exception using errcode = 'CCE03', message = 'The event is unavailable.';
  end if;
  if v_status not in ('Draft', 'Archived') then
    raise exception using
      errcode = 'CCE04',
      message = 'Only Draft or Archived events can be deleted.';
  end if;
  if v_updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = 'CCE05',
      message = 'The event changed. Refresh and confirm the deletion again.';
  end if;

  perform ceit_connect_private.lock_event_delete_descendants(p_event_id);

  if v_banner_url is not null then
    if public.event_banner_url_is_valid(p_event_id, v_banner_url) then
      v_banner_file := substring(
        v_banner_url
        from (
          '^https://[^./?#]+\.supabase\.co/storage/v1/object/public/banners/'
          || p_event_id::text
          || '/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp)$'
        )
      );
      v_object_path := p_event_id::text || '/' || v_banner_file;

      insert into public.event_storage_cleanup_jobs (
        event_id, bucket_id, object_path, status, attempt_count,
        claim_token, lease_expires_at, last_error, last_attempt_at, completed_at
      )
      values (
        p_event_id, 'banners', v_object_path, 'pending', 0,
        null, null, null, null, null
      )
      on conflict (bucket_id, object_path) do update
      set
        event_id = excluded.event_id,
        updated_at = pg_catalog.clock_timestamp()
      returning id into v_cleanup_job_id;
    else
      -- Invalid or already-missing stored banners never make database deletion
      -- impossible. The route reports that automatic cleanup was unavailable.
      v_cleanup_unavailable := true;
    end if;
  end if;

  delete from public.events as event_row
  where event_row.id = p_event_id;
  get diagnostics v_deleted = row_count;
  if v_deleted <> 1 then
    raise exception using
      errcode = 'CCE07',
      message = 'The event could not be deleted safely.';
  end if;

  return query select p_event_id, v_cleanup_job_id, v_cleanup_unavailable;
end;
$$;

alter function ceit_connect_private.perform_event_delete(uuid, timestamptz)
owner to postgres;
revoke all on function ceit_connect_private.perform_event_delete(uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function ceit_connect_private.perform_event_delete(uuid, timestamptz)
to ceit_event_delete_executor;

create function public.delete_event(
  p_event_id uuid,
  p_actor_id uuid,
  p_expected_updated_at timestamptz
)
returns table (
  out_event_id uuid,
  out_cleanup_job_id uuid,
  out_cleanup_unavailable boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_event_id is null or p_actor_id is null or p_expected_updated_at is null then
    raise exception using
      errcode = 'CCE02',
      message = 'The event ID, actor, and expected version are required.';
  end if;

  -- Authorization is the first database read and occurs before every lock and
  -- before the private cascade context exists.
  if ceit_connect_private.event_delete_actor_is_active_admin(p_actor_id)
     is not true then
    raise exception using
      errcode = 'CCE01',
      message = 'Only an active Admin can delete events.';
  end if;

  insert into ceit_connect_private.event_delete_cascade_context (
    transaction_id, event_id, actor_id
  )
  values (pg_catalog.pg_current_xact_id(), p_event_id, p_actor_id);

  begin
    return query
    select deletion.out_event_id,
           deletion.out_cleanup_job_id,
           deletion.out_cleanup_unavailable
    from ceit_connect_private.perform_event_delete(
      p_event_id,
      p_expected_updated_at
    ) as deletion;

    -- Run the deferred task-delete invariant while the non-forgeable context
    -- still exists, then restore its normal initially-deferred mode.
    set constraints public.tasks_preserve_active_event_task_on_delete immediate;
    set constraints public.tasks_preserve_active_event_task_on_delete deferred;

    delete from ceit_connect_private.event_delete_cascade_context as context_row
    where context_row.transaction_id = pg_catalog.pg_current_xact_id()
      and context_row.event_id = p_event_id;
  exception
    when others then
      delete from ceit_connect_private.event_delete_cascade_context as context_row
      where context_row.transaction_id = pg_catalog.pg_current_xact_id()
        and context_row.event_id = p_event_id;
      raise;
  end;
end;
$$;

revoke all on function public.delete_event(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.delete_event(uuid, uuid, timestamptz)
to service_role;

grant ceit_event_delete_executor to postgres;
grant create on schema public to ceit_event_delete_executor;
alter function public.delete_event(uuid, uuid, timestamptz)
owner to ceit_event_delete_executor;
revoke create on schema public from ceit_event_delete_executor;
revoke ceit_event_delete_executor from postgres;

do $$
declare
  v_has_membership_options boolean;
  v_membership_count integer;
  v_valid_membership_count integer;
begin
  select pg_catalog.count(*) = 2
  into v_has_membership_options
  from pg_catalog.pg_attribute as attribute
  where attribute.attrelid = 'pg_catalog.pg_auth_members'::regclass
    and attribute.attname in ('inherit_option', 'set_option')
    and not attribute.attisdropped;

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(*) filter (
      where membership.roleid = 'ceit_event_delete_executor'::regrole
        and membership.member = 'postgres'::regrole
        and membership.admin_option is true
        and (pg_catalog.to_jsonb(membership) ->> 'inherit_option')::boolean is false
        and (pg_catalog.to_jsonb(membership) ->> 'set_option')::boolean is false
    )::integer
  into v_membership_count, v_valid_membership_count
  from pg_catalog.pg_auth_members as membership
  where membership.roleid = 'ceit_event_delete_executor'::regrole
     or membership.member = 'ceit_event_delete_executor'::regrole;

  if (
    v_has_membership_options
    and (v_membership_count <> 1 or v_valid_membership_count <> 1)
  ) or (
    not v_has_membership_options
    and v_membership_count <> 0
  ) then
    raise exception 'ceit_event_delete_executor retained unsafe role memberships.';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_proc as procedure
    where procedure.proowner = 'ceit_event_delete_executor'::regrole
  ) <> 1
     or coalesce((
       select procedure.proowner = 'ceit_event_delete_executor'::regrole
       from pg_catalog.pg_proc as procedure
       where procedure.oid = 'public.delete_event(uuid,uuid,timestamptz)'::regprocedure
     ), false) is not true then
    raise exception 'ceit_event_delete_executor must own only delete_event.';
  end if;

  if pg_catalog.has_schema_privilege(
       'ceit_event_delete_executor',
       'public',
       'CREATE'
     ) then
    raise exception 'ceit_event_delete_executor retained CREATE on schema public.';
  end if;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.delete_event(uuid,uuid,timestamptz)',
       'EXECUTE'
     )
     or pg_catalog.has_function_privilege(
       'authenticated',
       'public.delete_event(uuid,uuid,timestamptz)',
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.delete_event(uuid,uuid,timestamptz)',
       'EXECUTE'
     )
     or exists (
       select 1
       from pg_catalog.pg_proc as procedure
       cross join lateral pg_catalog.aclexplode(procedure.proacl) as privilege
       where procedure.oid = 'public.delete_event(uuid,uuid,timestamptz)'::regprocedure
         and privilege.grantee = 0
     ) then
    raise exception 'delete_event has an unsafe execute ACL.';
  end if;
end
$$;

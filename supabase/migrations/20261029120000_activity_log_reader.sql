-- Batch 12 Run 1: fixed-shape activity-log reader and raw-read removal.
-- The reader scans at most 2,000 cheap-filtered candidates per request while
-- trying to produce 21 safe matches. When that cap is reached it returns the
-- matches found so far with has_more = true and a cursor at the last scanned
-- candidate, so Load more continues the scan without an unbounded
-- confidential-access evaluation.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch 12 must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create index activity_log_created_at_id_idx
on public.activity_log (created_at, id);

create function public.list_activity_log(
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
      elsif v_candidate.action = 'DELETE'
            and (v_snapshot ->> 'is_confidential')::boolean is false then
        -- Deleted rows are action + missing-live-row classified. The nullable
        -- FK is never the classifier because Batch 13d will remove that FK.
        -- No current row exists to prove access, so details appear only when
        -- the parent event still exists and is Active or Archived. A Draft or
        -- missing parent fails closed to the minimal masked shape.
        select parent.name, parent.status
        into v_deleted_event_name, v_deleted_event_status
        from public.events as parent
        where parent.id = (v_snapshot ->> 'event_id')::uuid;

        if found and v_deleted_event_status in ('Active', 'Archived') then
          v_row_masked := false;
          v_row_task_id := (v_snapshot ->> 'id')::uuid;
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

drop policy "activity_log_select" on public.activity_log;

revoke select, insert, update, delete, truncate, references, trigger
on table public.activity_log
from public, anon, authenticated;

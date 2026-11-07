-- Phase 4B Batch B, Stage 1: additive semantic activity subjects and the
-- backwards-compatible safe reader. Stage 2 installs the semantic writers.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch B Stage 1 must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

create table ceit_connect_private.activity_type_catalog (
  activity_type text primary key,
  broad_action text not null check (broad_action in ('INSERT', 'UPDATE', 'DELETE')),
  subject_kind text not null check (subject_kind in ('task', 'event', 'phase', 'person', 'bulk')),
  audience text not null check (audience in ('task_access', 'phase_access', 'leadership')),
  summary_text text not null,
  allowed_payload_keys text[] not null,
  unique (activity_type, broad_action, subject_kind)
);

revoke all on table ceit_connect_private.activity_type_catalog
from public, anon, authenticated, service_role;

insert into ceit_connect_private.activity_type_catalog
  (activity_type, broad_action, subject_kind, audience, summary_text, allowed_payload_keys)
values
  ('event_created', 'INSERT', 'event', 'leadership', 'Event created', array['event_status']),
  ('event_created_from_template', 'INSERT', 'event', 'leadership', 'Event created from archived template', array['event_status','source_event_id']),
  ('event_edited', 'UPDATE', 'event', 'leadership', 'Event edited', array['event_status','changed_fields']),
  ('event_launched', 'UPDATE', 'event', 'leadership', 'Event launched', array['event_status','old_status','new_status']),
  ('event_archived', 'UPDATE', 'event', 'leadership', 'Event archived', array['event_status','old_status','new_status']),
  ('event_deleted', 'DELETE', 'event', 'leadership', 'Event deleted', array['event_status','event_name']),
  ('phase_added', 'INSERT', 'phase', 'phase_access', 'Phase added', array['event_status','phase','position','affected_task_ids']),
  ('phase_renamed', 'UPDATE', 'phase', 'phase_access', 'Phase renamed', array['event_status','phase','old_phase','new_phase','old_position','new_position','affected_task_ids']),
  ('phase_moved', 'UPDATE', 'phase', 'phase_access', 'Phase moved', array['event_status','phase','old_position','new_position','affected_task_ids']),
  ('phase_removed', 'DELETE', 'phase', 'phase_access', 'Phase removed', array['event_status','phase','old_position','affected_task_ids']),
  ('task_created', 'INSERT', 'task', 'task_access', 'Task created', array['event_id','committee_id']),
  ('task_updated', 'UPDATE', 'task', 'task_access', 'Task updated', array['event_id','committee_id','changed_fields']),
  ('task_deleted', 'DELETE', 'task', 'task_access', 'Task deleted', array['event_id','committee_id']),
  ('task_assigned', 'UPDATE', 'task', 'task_access', 'Task assigned', array['event_id','committee_id','user_ids']),
  ('task_unassigned', 'UPDATE', 'task', 'task_access', 'Task unassigned', array['event_id','committee_id','user_ids']),
  ('task_left', 'DELETE', 'task', 'task_access', 'Left task', array['event_id','committee_id','user_id']),
  ('task_leave_requested', 'INSERT', 'task', 'task_access', 'Leave request sent', array['event_id','committee_id','request_id','requester_id']),
  ('task_leave_approved', 'UPDATE', 'task', 'task_access', 'Leave request approved', array['event_id','committee_id','request_id','requester_id','resolver_id']),
  ('task_leave_rejected', 'UPDATE', 'task', 'task_access', 'Leave request rejected', array['event_id','committee_id','request_id','requester_id','resolver_id']),
  ('task_leave_cancelled', 'DELETE', 'task', 'task_access', 'Leave request cancelled', array['event_id','committee_id','request_id','requester_id','resolver_id','reason_code']),
  ('task_backup_requested', 'INSERT', 'task', 'task_access', 'Backup requested', array['event_id','committee_id']),
  ('task_backup_cancelled', 'DELETE', 'task', 'task_access', 'Backup request cancelled', array['event_id','committee_id']),
  ('task_volunteered', 'INSERT', 'task', 'task_access', 'Volunteered for task', array['event_id','committee_id','user_id']),
  ('task_status_changed', 'UPDATE', 'task', 'task_access', 'Task status changed', array['event_id','committee_id','old_status','new_status']),
  ('task_confidentiality_changed', 'UPDATE', 'task', 'task_access', 'Task confidentiality changed', array['event_id','committee_id','old_confidential','new_confidential']),
  ('member_invited', 'INSERT', 'person', 'leadership', 'Member invited', array['old_committee_id','new_committee_id','target_role']),
  ('officer_invited', 'INSERT', 'person', 'leadership', 'Officer invited', array['old_committee_id','new_committee_id','target_role','invite_id']),
  ('invitation_cancelled', 'DELETE', 'person', 'leadership', 'Invitation canceled', array['old_committee_id','new_committee_id','target_role','invite_id']),
  ('officer_added', 'INSERT', 'person', 'leadership', 'Officer added', array['old_committee_id','new_committee_id','target_role']),
  ('person_deactivated', 'UPDATE', 'person', 'leadership', 'Person deactivated', array['old_committee_id','new_committee_id','target_role']),
  ('person_reactivated', 'UPDATE', 'person', 'leadership', 'Person reactivated', array['old_committee_id','new_committee_id','target_role']),
  ('person_removed', 'DELETE', 'person', 'leadership', 'Former member removed', array['old_committee_id','new_committee_id','target_role']),
  ('committee_changed', 'UPDATE', 'person', 'leadership', 'Committee changed', array['old_committee_id','new_committee_id','target_role']),
  ('appointed_coadmin', 'UPDATE', 'person', 'leadership', 'Appointed Co-Admin', array['old_committee_id','new_committee_id','target_role']),
  ('appointed_admin', 'UPDATE', 'person', 'leadership', 'Appointed Admin', array['old_committee_id','new_committee_id','target_role']),
  ('returned_to_member', 'UPDATE', 'person', 'leadership', 'Returned to Member', array['old_committee_id','new_committee_id','target_role']),
  ('admin_stepped_down', 'UPDATE', 'person', 'leadership', 'Admin stepped down', array['old_committee_id','new_committee_id','target_role']),
  ('bulk_events_deleted', 'DELETE', 'bulk', 'leadership', 'Events deleted', array['count','ids']),
  ('bulk_members_removed', 'DELETE', 'bulk', 'leadership', 'Members removed', array['count','ids']);

alter table public.activity_log
  add column actor_kind text,
  add column subject_kind text,
  add column activity_type text,
  add column event_id uuid,
  add column subject_user_id uuid,
  add column task_was_confidential boolean,
  add column task_title_snapshot text;

update public.activity_log
set actor_kind = case when user_id is null then 'unavailable' else 'user' end;

alter table public.activity_log
  add constraint activity_log_actor_kind_check
    check (actor_kind is null or actor_kind in ('user', 'system', 'unavailable')),
  add constraint activity_log_actor_shape_check
    check (
      actor_kind is null
      or actor_kind = 'user' and user_id is not null
      or actor_kind in ('system', 'unavailable') and user_id is null
    ),
  add constraint activity_log_semantic_shape_check
    check (
      (activity_type is null and subject_kind is null)
      or (activity_type is not null and subject_kind is not null and actor_kind is not null)
    ),
  add constraint activity_log_activity_type_shape_fkey
    foreign key (activity_type, action, subject_kind)
    references ceit_connect_private.activity_type_catalog(activity_type, broad_action, subject_kind),
  add constraint activity_log_subject_ids_check
    check (
      activity_type is null
      or subject_kind = 'task' and task_id is not null and event_id is not null and subject_user_id is null
      or subject_kind in ('event', 'phase') and event_id is not null and task_id is null and subject_user_id is null
      or subject_kind = 'person'
         and task_id is null and event_id is null
         and (
           subject_user_id is not null
           or activity_type in ('officer_invited', 'invitation_cancelled')
         )
      or subject_kind = 'bulk' and task_id is null and event_id is null and subject_user_id is null
    ),
  add constraint activity_log_task_confidentiality_check
    check (
      activity_type is null
      or subject_kind = 'task' and task_was_confidential is not null
      or subject_kind <> 'task' and task_was_confidential is null
    ),
  add constraint activity_log_task_title_snapshot_check
    check (
      task_title_snapshot is null
      or (
        activity_type = 'task_deleted'
        and subject_kind = 'task'
        and task_was_confidential is false
        and pg_catalog.char_length(task_title_snapshot) between 1 and 1000
      )
    ),
  add constraint activity_log_event_phase_payload_check
    check (
      activity_type is null
      or subject_kind not in ('event', 'phase')
      or coalesce((
        pg_catalog.jsonb_typeof(changes) = 'object'
        and pg_catalog.jsonb_typeof(changes -> 'event_status') = 'string'
        and changes ->> 'event_status' in ('Draft', 'Active', 'Archived')
        and (
          subject_kind <> 'phase'
          or (
            pg_catalog.jsonb_typeof(changes -> 'affected_task_ids') = 'array'
            and pg_catalog.jsonb_typeof(changes -> 'phase') = 'string'
          )
        )
      ), false)
    ),
  add constraint activity_log_event_name_snapshot_check
    check (
      activity_type is null
      or not coalesce(changes ? 'event_name', false)
      or coalesce((
        activity_type = 'event_deleted'
        and subject_kind = 'event'
        and pg_catalog.jsonb_typeof(changes -> 'event_name') = 'string'
        and pg_catalog.btrim(changes ->> 'event_name') <> ''
        and pg_catalog.char_length(changes ->> 'event_name') between 1 and 150
      ), false)
    ),
  add constraint activity_log_bulk_payload_check
    check (
      activity_type is null
      or subject_kind <> 'bulk'
      or coalesce((
        pg_catalog.jsonb_typeof(changes) = 'object'
        and pg_catalog.jsonb_typeof(changes -> 'count') = 'number'
        and pg_catalog.jsonb_typeof(changes -> 'ids') = 'array'
      ), false)
    ),
  add constraint activity_log_assignment_payload_check
    check (
      activity_type is null
      or activity_type not in ('task_assigned', 'task_unassigned')
      or coalesce((
        pg_catalog.jsonb_typeof(changes) = 'object'
        and pg_catalog.jsonb_typeof(changes -> 'user_ids') = 'array'
        and pg_catalog.jsonb_array_length(changes -> 'user_ids') = pg_catalog.jsonb_array_length(
          pg_catalog.jsonb_path_query_array(
            changes -> 'user_ids',
            '$[*] ? (@.type() == "string" && @ like_regex "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" flag "i")'
          )
        )
      ), false)
    ),
  add constraint activity_log_leave_requester_payload_check
    check (
      activity_type is null
      or activity_type not in (
        'task_leave_requested', 'task_leave_approved',
        'task_leave_rejected', 'task_leave_cancelled'
      )
      or coalesce((
        pg_catalog.jsonb_typeof(changes) = 'object'
        and pg_catalog.jsonb_typeof(changes -> 'requester_id') = 'string'
        and (changes ->> 'requester_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ), false)
    ),
  add constraint activity_log_person_payload_check
    check (
      activity_type is null
      or subject_kind <> 'person'
      or coalesce((
        pg_catalog.jsonb_typeof(changes) = 'object'
        and changes ? 'old_committee_id'
        and changes ? 'new_committee_id'
        and pg_catalog.jsonb_typeof(changes -> 'target_role') = 'string'
        and changes ->> 'target_role' in ('Admin', 'Co-Admin', 'Member')
        and (
          changes -> 'old_committee_id' = 'null'::jsonb
          or (changes ->> 'old_committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
        and (
          changes -> 'new_committee_id' = 'null'::jsonb
          or (changes ->> 'new_committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )
      ), false)
    );

create function ceit_connect_private.activity_event_status_visible_for_user(
  p_event_status text,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_event_status <> 'Draft'
    or exists (
      select 1
      from public.users as profile
      where profile.id = p_user_id
        and profile.is_active
        and profile.role in ('Admin', 'Co-Admin')
    );
$$;

alter function ceit_connect_private.activity_event_status_visible_for_user(text, uuid)
owner to postgres;
revoke all on function ceit_connect_private.activity_event_status_visible_for_user(text, uuid)
from public, anon, authenticated, service_role;

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
  v_search text := pg_catalog.btrim(coalesce(p_search, ''), E' \t\n\r\f\v');
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
  v_phase_visible boolean;
  v_related_names text;
  v_related_count integer;
begin
  if p_sort is null or p_sort not in ('newest', 'oldest')
     or p_action is not null and p_action not in ('INSERT', 'UPDATE', 'DELETE')
     or p_page_size is null or p_page_size not between 1 and 20
     or (p_cursor_created_at is null) <> (p_cursor_id is null)
     or p_date_from is not null and p_date_to is not null and p_date_from > p_date_to
     or pg_catalog.char_length(v_search) > 100
     or exists (
       select 1
       from pg_catalog.generate_series(1, pg_catalog.char_length(v_search)) as positions(character_position)
       where pg_catalog.ascii(pg_catalog.substr(v_search, positions.character_position, 1)) between 0 and 31
          or pg_catalog.ascii(pg_catalog.substr(v_search, positions.character_position, 1)) = 127
     ) then
    raise exception using errcode = 'CAL02', message = 'The activity log request is invalid.';
  end if;

  v_from := case when p_date_from is null then null else p_date_from::timestamp at time zone 'Asia/Manila' end;
  v_until := case when p_date_to is null then null else (p_date_to + 1)::timestamp at time zone 'Asia/Manila' end;

  select profile.role, profile.is_active
  into v_caller_role, v_caller_active
  from public.users as profile
  where profile.id = v_caller_id;

  if not found or not coalesce(v_caller_active, false) then
    raise exception using errcode = 'CAL01', message = 'Activity history is unavailable.';
  end if;

  if p_task_id is null then
    if v_caller_role not in ('Admin', 'Co-Admin') then
      raise exception using errcode = 'CAL01', message = 'Activity history is unavailable.';
    end if;
  else
    select stored.primary_assignees, stored.assist_assignees
    into v_exact_primary, v_exact_assist
    from public.tasks as stored
    where stored.id = p_task_id;

    if not found
       or public.task_content_access_for_user(p_task_id, v_caller_id) is distinct from 'real'
       or (v_caller_role = 'Member' and not (
         coalesce(v_caller_id = any(v_exact_primary), false)
         or coalesce(v_caller_id = any(v_exact_assist), false)
       ))
       or v_caller_role is null
       or v_caller_role not in ('Admin', 'Co-Admin', 'Member') then
      raise exception using errcode = 'CAL01', message = 'Activity history is unavailable.';
    end if;
  end if;

  if p_sort = 'newest' then
    open v_cursor for
      select
        log_row.id,
        log_row.task_id as stored_task_id,
        log_row.user_id,
        log_row.actor_kind,
        log_row.subject_kind,
        log_row.activity_type,
        log_row.event_id as stored_event_id,
        log_row.subject_user_id,
        log_row.task_was_confidential,
        log_row.task_title_snapshot,
        log_row.action,
        log_row.changes,
        log_row.created_at,
        catalog.summary_text,
        live_task.id as live_task_id,
        live_task.committee_id as live_committee_id,
        live_event.name as live_event_name,
        live_event.status as live_event_status,
        live_committee.name as live_committee_name,
        actor.full_name as stored_actor_name,
        actor.anonymized_at as actor_anonymized_at,
        target.full_name as target_name,
        target.anonymized_at as target_anonymized_at
      from public.activity_log as log_row
      left join ceit_connect_private.activity_type_catalog as catalog
        on catalog.activity_type = log_row.activity_type
      left join public.tasks as live_task on live_task.id = log_row.task_id
      left join public.events as live_event
        on live_event.id = coalesce(log_row.event_id, live_task.event_id)
      left join public.committees as live_committee on live_committee.id = live_task.committee_id
      left join public.users as actor on actor.id = log_row.user_id
      left join public.users as target on target.id = log_row.subject_user_id
      where (p_action is null or log_row.action = p_action)
        and (v_from is null or log_row.created_at >= v_from)
        and (v_until is null or log_row.created_at < v_until)
        and (p_task_id is null or log_row.task_id = p_task_id)
        and (p_cursor_created_at is null or (log_row.created_at, log_row.id) < (p_cursor_created_at, p_cursor_id))
      order by log_row.created_at desc, log_row.id desc
      limit 2001;
  else
    open v_cursor for
      select
        log_row.id,
        log_row.task_id as stored_task_id,
        log_row.user_id,
        log_row.actor_kind,
        log_row.subject_kind,
        log_row.activity_type,
        log_row.event_id as stored_event_id,
        log_row.subject_user_id,
        log_row.task_was_confidential,
        log_row.task_title_snapshot,
        log_row.action,
        log_row.changes,
        log_row.created_at,
        catalog.summary_text,
        live_task.id as live_task_id,
        live_task.committee_id as live_committee_id,
        live_event.name as live_event_name,
        live_event.status as live_event_status,
        live_committee.name as live_committee_name,
        actor.full_name as stored_actor_name,
        actor.anonymized_at as actor_anonymized_at,
        target.full_name as target_name,
        target.anonymized_at as target_anonymized_at
      from public.activity_log as log_row
      left join ceit_connect_private.activity_type_catalog as catalog
        on catalog.activity_type = log_row.activity_type
      left join public.tasks as live_task on live_task.id = log_row.task_id
      left join public.events as live_event
        on live_event.id = coalesce(log_row.event_id, live_task.event_id)
      left join public.committees as live_committee on live_committee.id = live_task.committee_id
      left join public.users as actor on actor.id = log_row.user_id
      left join public.users as target on target.id = log_row.subject_user_id
      where (p_action is null or log_row.action = p_action)
        and (v_from is null or log_row.created_at >= v_from)
        and (v_until is null or log_row.created_at < v_until)
        and (p_task_id is null or log_row.task_id = p_task_id)
        and (p_cursor_created_at is null or (log_row.created_at, log_row.id) > (p_cursor_created_at, p_cursor_id))
      order by log_row.created_at asc, log_row.id asc
      limit 2001;
  end if;

  loop
    fetch v_cursor into v_candidate;
    exit when not found;
    v_scanned := v_scanned + 1;
    if v_scanned = 2001 then v_candidate_overflow := true; exit; end if;
    v_last_created_at := v_candidate.created_at;
    v_last_id := v_candidate.id;

    v_row_masked := true;
    v_row_task_id := null;
    v_row_title := 'Confidential Task';
    v_row_event_name := null;
    v_row_committee_id := null;
    v_row_committee_name := null;
    v_row_actor_name := null;
    v_row_summary := null;

    if v_candidate.activity_type is not null then
      if v_candidate.subject_kind = 'task' then
        if v_candidate.live_task_id is not null
           and public.task_content_access_for_user(v_candidate.live_task_id, v_caller_id) = 'real' then
          v_row_masked := false;
          v_row_task_id := v_candidate.live_task_id;
          v_row_event_name := v_candidate.live_event_name;
          v_row_committee_id := v_candidate.live_committee_id;
          v_row_committee_name := v_candidate.live_committee_name;
          v_row_title := case
            when v_candidate.activity_type = 'task_deleted'
              and v_caller_role in ('Admin', 'Co-Admin')
              and v_candidate.task_was_confidential is false
              and v_candidate.task_title_snapshot is not null
            then v_candidate.task_title_snapshot
            when v_candidate.activity_type = 'task_deleted' then 'Deleted task'
            else (select task_row.title from public.tasks as task_row where task_row.id = v_candidate.live_task_id)
          end;
        elsif v_candidate.live_task_id is null
              and v_caller_role in ('Admin', 'Co-Admin')
              and v_candidate.task_was_confidential is false then
          v_row_masked := false;
          v_row_title := coalesce(v_candidate.task_title_snapshot, 'Deleted task');
          v_row_event_name := v_candidate.live_event_name;
          v_row_committee_id := case
            when (v_candidate.changes ->> 'committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (v_candidate.changes ->> 'committee_id')::uuid
          end;
          select stored_committee.name into v_row_committee_name
          from public.committees as stored_committee where stored_committee.id = v_row_committee_id;
        end if;
        if not v_row_masked then
          v_row_summary := array[v_candidate.summary_text]::text[];
          if v_candidate.activity_type in ('task_assigned', 'task_unassigned') then
            select
              pg_catalog.string_agg(resolved.display_name, ', ' order by resolved.position)
                filter (where resolved.position <= 3),
              pg_catalog.count(*)::integer
            into v_related_names, v_related_count
            from (
              select
                referenced.position,
                case
                  when profile.anonymized_at is not null or profile.id is null then 'Former member'
                  else profile.full_name
                end as display_name
              from pg_catalog.jsonb_array_elements_text(
                case
                  when pg_catalog.jsonb_typeof(v_candidate.changes -> 'user_ids') = 'array'
                  then v_candidate.changes -> 'user_ids'
                  else '[]'::jsonb
                end
              ) with ordinality as referenced(user_id, position)
              left join public.users as profile
                on profile.id = case
                  when referenced.user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then referenced.user_id::uuid
                end
            ) as resolved;
            if v_related_count > 0 then
              v_row_summary := array[
                v_candidate.summary_text || ': ' || v_related_names
                || case when v_related_count > 3 then ' and ' || (v_related_count - 3)::text || ' more' else '' end
              ]::text[];
            end if;
          elsif v_candidate.activity_type in (
            'task_leave_approved', 'task_leave_rejected', 'task_leave_cancelled'
          ) then
            select case
              when profile.anonymized_at is not null or profile.id is null then 'Former member'
              else profile.full_name
            end
            into v_related_names
            from (select case
              when (v_candidate.changes ->> 'requester_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then (v_candidate.changes ->> 'requester_id')::uuid
            end as user_id) as referenced
            left join public.users as profile on profile.id = referenced.user_id;
            v_row_summary := array[v_candidate.summary_text || ': ' || v_related_names]::text[];
          end if;
        end if;

      elsif v_candidate.subject_kind = 'event' then
        v_deleted_event_status := coalesce(v_candidate.live_event_status, v_candidate.changes ->> 'event_status');
        if ceit_connect_private.activity_event_status_visible_for_user(v_deleted_event_status, v_caller_id) then
          v_row_masked := false;
          v_row_title := 'Event';
          v_row_event_name := coalesce(
            v_candidate.live_event_name,
            v_candidate.changes ->> 'event_name',
            'Deleted event'
          );
          v_row_summary := array[v_candidate.summary_text]::text[];
        end if;

      elsif v_candidate.subject_kind = 'phase' then
        v_deleted_event_status := coalesce(v_candidate.live_event_status, v_candidate.changes ->> 'event_status');
        if ceit_connect_private.activity_event_status_visible_for_user(v_deleted_event_status, v_caller_id) then
          v_row_masked := false;
          v_row_event_name := coalesce(
            v_candidate.live_event_name,
            v_candidate.changes ->> 'event_name',
            'Deleted event'
          );
          v_phase_visible := v_caller_role = 'Admin';
          if not v_phase_visible
             and v_caller_role = 'Co-Admin'
             and v_candidate.activity_type <> 'phase_removed' then
            select exists (
              select 1
              from pg_catalog.jsonb_array_elements_text(
                case
                  when pg_catalog.jsonb_typeof(v_candidate.changes -> 'affected_task_ids') = 'array'
                  then v_candidate.changes -> 'affected_task_ids'
                  else '[]'::jsonb
                end
              ) as affected(task_id)
              join public.tasks as affected_task
                on affected.task_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
               and affected_task.id = affected.task_id::uuid
              where public.task_content_access_for_user(affected_task.id, v_caller_id) = 'real'
            ) into v_phase_visible;
          end if;
          if v_phase_visible then
            v_row_title := case
              when v_candidate.activity_type = 'phase_renamed' then v_candidate.changes ->> 'new_phase'
              else v_candidate.changes ->> 'phase'
            end;
            v_row_summary := array[v_candidate.summary_text]::text[];
          else
            v_row_title := 'Event phases';
            v_row_summary := array['Event phases updated']::text[];
          end if;
        end if;

      elsif v_candidate.subject_kind = 'person' then
        if v_caller_role in ('Admin', 'Co-Admin') then
          v_row_masked := false;
          v_row_title := case
            when v_candidate.subject_user_id is null
              and v_candidate.activity_type in ('officer_invited', 'invitation_cancelled')
            then 'Officer invitation'
            when v_candidate.target_anonymized_at is not null then 'Former member'
            when v_candidate.target_name is null then 'Former member'
            else v_candidate.target_name
          end;
          v_row_event_name := '';
          v_row_committee_id := case
            when (v_candidate.changes ->> 'new_committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (v_candidate.changes ->> 'new_committee_id')::uuid
            when (v_candidate.changes ->> 'old_committee_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (v_candidate.changes ->> 'old_committee_id')::uuid
          end;
          select stored_committee.name into v_row_committee_name
          from public.committees as stored_committee where stored_committee.id = v_row_committee_id;
          v_row_summary := array[v_candidate.summary_text]::text[];
        end if;

      elsif v_candidate.subject_kind = 'bulk' then
        if v_caller_role in ('Admin', 'Co-Admin') then
          v_row_masked := false;
          v_row_title := 'Bulk action';
          v_row_event_name := '';
          v_row_summary := array[
            coalesce(v_candidate.changes ->> 'count', '0') || case
              when v_candidate.activity_type = 'bulk_events_deleted' then ' events deleted'
              else ' members removed'
            end
          ]::text[];
        end if;
      end if;

      if not v_row_masked then
        v_row_actor_name := case
          when v_candidate.actor_kind = 'system' then 'System'
          when v_candidate.actor_kind = 'unavailable' then 'Unavailable actor'
          when v_candidate.actor_anonymized_at is not null then 'Former member'
          when v_candidate.user_id is null or v_candidate.stored_actor_name is null then 'Unavailable actor'
          else v_candidate.stored_actor_name
        end;
      end if;

    else
      -- Legacy task snapshots retain the exact pre-B masking and summary path.
      v_snapshot := case v_candidate.action when 'UPDATE' then v_candidate.changes -> 'new' else v_candidate.changes end;
      v_old_snapshot := case v_candidate.action when 'UPDATE' then v_candidate.changes -> 'old' else null end;
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
        and (v_candidate.action <> 'UPDATE' or (
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
        ));

      if v_snapshot_valid then
        if v_candidate.live_task_id is not null
           and public.task_content_access_for_user(v_candidate.live_task_id, v_caller_id) = 'real' then
          v_row_masked := false;
          v_row_task_id := v_candidate.live_task_id;
          v_row_title := v_snapshot ->> 'title';
          v_row_event_name := v_candidate.live_event_name;
          v_row_committee_id := v_candidate.live_committee_id;
          v_row_committee_name := v_candidate.live_committee_name;
        elsif v_candidate.stored_task_id is not null
              and (v_snapshot ->> 'id')::uuid = v_candidate.stored_task_id then
          select
            coalesce(pg_catalog.bool_or(case
              when sibling.activity_type is not null then sibling.task_was_confidential
              when sibling.action = 'UPDATE' then
                sibling.changes -> 'old' -> 'is_confidential' = 'true'::jsonb
                or sibling.changes -> 'new' -> 'is_confidential' = 'true'::jsonb
              else sibling.changes -> 'is_confidential' = 'true'::jsonb
            end), false),
            coalesce(pg_catalog.bool_or(case
              when sibling.activity_type is not null then
                sibling.subject_kind is distinct from 'task'
                or sibling.task_was_confidential is null
              when sibling.action = 'UPDATE' then
                pg_catalog.jsonb_typeof(sibling.changes -> 'old') is distinct from 'object'
                or pg_catalog.jsonb_typeof(sibling.changes -> 'new') is distinct from 'object'
                or pg_catalog.jsonb_typeof(sibling.changes -> 'old' -> 'is_confidential') is distinct from 'boolean'
                or pg_catalog.jsonb_typeof(sibling.changes -> 'new' -> 'is_confidential') is distinct from 'boolean'
                or sibling.changes -> 'old' ->> 'id' is distinct from v_candidate.stored_task_id::text
                or sibling.changes -> 'new' ->> 'id' is distinct from v_candidate.stored_task_id::text
              else pg_catalog.jsonb_typeof(sibling.changes) is distinct from 'object'
                or pg_catalog.jsonb_typeof(sibling.changes -> 'is_confidential') is distinct from 'boolean'
                or sibling.changes ->> 'id' is distinct from v_candidate.stored_task_id::text
            end), true)
          into v_orphan_has_confidential, v_orphan_evidence_invalid
          from public.activity_log as sibling
          where sibling.task_id = v_candidate.stored_task_id;

          select parent.name, parent.status into v_deleted_event_name, v_deleted_event_status
          from public.events as parent where parent.id = (v_snapshot ->> 'event_id')::uuid;
          v_orphan_parent_allowed := not found or v_deleted_event_status in ('Active', 'Archived');
          if not v_orphan_has_confidential and not v_orphan_evidence_invalid and v_orphan_parent_allowed then
            v_row_masked := false;
            v_row_title := v_snapshot ->> 'title';
            v_row_event_name := v_deleted_event_name;
            v_row_committee_id := (v_snapshot ->> 'committee_id')::uuid;
            select stored_committee.name into v_row_committee_name
            from public.committees as stored_committee where stored_committee.id = v_row_committee_id;
          end if;
        end if;
      end if;

      if not v_row_masked then
        v_row_actor_name := case
          when v_candidate.actor_anonymized_at is not null then 'Former member'
          when v_candidate.user_id is null or v_candidate.stored_actor_name is null then 'Unavailable actor'
          else v_candidate.stored_actor_name
        end;
        if v_candidate.action = 'INSERT' then v_row_summary := array['Task created']::text[];
        elsif v_candidate.action = 'DELETE' then v_row_summary := array['Task deleted']::text[];
        else
          v_row_summary := array[]::text[];
          if (v_old_snapshot -> 'title') is distinct from (v_snapshot -> 'title') then v_row_summary := pg_catalog.array_append(v_row_summary, 'Title updated'); end if;
          if (v_old_snapshot -> 'description') is distinct from (v_snapshot -> 'description') then v_row_summary := pg_catalog.array_append(v_row_summary, 'Description updated'); end if;
          if (v_old_snapshot -> 'phase') is distinct from (v_snapshot -> 'phase') then v_row_summary := pg_catalog.array_append(v_row_summary, 'Phase updated'); end if;
          if (v_old_snapshot -> 'status') is distinct from (v_snapshot -> 'status') then v_row_summary := pg_catalog.array_append(v_row_summary, 'Status updated'); end if;
          if (v_old_snapshot -> 'priority') is distinct from (v_snapshot -> 'priority') then v_row_summary := pg_catalog.array_append(v_row_summary, 'Priority updated'); end if;
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
          if (v_old_snapshot -> 'request_backup') is distinct from (v_snapshot -> 'request_backup') then v_row_summary := pg_catalog.array_append(v_row_summary, 'Backup request updated'); end if;
          if (v_old_snapshot -> 'depends_on_task_id') is distinct from (v_snapshot -> 'depends_on_task_id') then v_row_summary := pg_catalog.array_append(v_row_summary, 'Dependency updated'); end if;
          if (v_old_snapshot -> 'event_id') is distinct from (v_snapshot -> 'event_id')
             or (v_old_snapshot -> 'committee_id') is distinct from (v_snapshot -> 'committee_id') then
            v_row_summary := pg_catalog.array_append(v_row_summary, 'Ownership updated');
          end if;
          if pg_catalog.cardinality(v_row_summary) = 0 then v_row_summary := array['Task updated']::text[]; end if;
        end if;
      end if;
    end if;

    if p_committee_id is not null then
      if v_candidate.subject_kind = 'person' then
        if not (
          v_candidate.changes ->> 'old_committee_id' = p_committee_id::text
          or v_candidate.changes ->> 'new_committee_id' = p_committee_id::text
        ) then continue; end if;
      elsif v_row_masked or v_row_committee_id is distinct from p_committee_id then
        continue;
      end if;
    end if;

    v_action_label := case v_candidate.action when 'INSERT' then 'Created' when 'UPDATE' then 'Updated' when 'DELETE' then 'Deleted' end;
    if v_search <> '' and (
      v_row_masked or not (
        pg_catalog.strpos(pg_catalog.lower(coalesce(v_row_actor_name, '')), pg_catalog.lower(v_search)) > 0
        or pg_catalog.strpos(pg_catalog.lower(v_action_label), pg_catalog.lower(v_search)) > 0
        or pg_catalog.strpos(pg_catalog.lower(coalesce(v_row_title, '')), pg_catalog.lower(v_search)) > 0
        or pg_catalog.strpos(pg_catalog.lower(coalesce(v_row_event_name, '')), pg_catalog.lower(v_search)) > 0
        or pg_catalog.strpos(pg_catalog.lower(coalesce(v_row_committee_name, '')), pg_catalog.lower(v_search)) > 0
      )
    ) then continue; end if;

    v_match_count := v_match_count + 1;
    v_results := v_results || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
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
    ));
    exit when v_match_count = p_page_size + 1;
  end loop;
  close v_cursor;

  if v_match_count > p_page_size then
    v_has_more := true;
    v_entry := v_results -> (p_page_size - 1);
    v_next_created_at := (v_entry ->> 'activity_created_at')::timestamptz;
    v_next_id := (v_entry ->> 'activity_id')::uuid;
  elsif v_candidate_overflow then
    v_has_more := true;
    v_next_created_at := v_last_created_at;
    v_next_id := v_last_id;
  end if;

  if v_match_count = 0 and v_has_more then
    return query select null::uuid, null::timestamptz, null::text, null::uuid,
      null::text, null::text, null::uuid, null::text, null::text, null::text[],
      null::boolean, true, v_next_created_at, v_next_id;
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
    case when pg_catalog.jsonb_typeof(entry.value -> 'change_summary') = 'array'
      then array(select pg_catalog.jsonb_array_elements_text(entry.value -> 'change_summary'))
      else null::text[] end,
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
) from public, anon, authenticated, service_role;
grant execute on function public.list_activity_log(
  uuid, text, text, uuid, date, date, text, timestamptz, uuid, integer
) to authenticated;

revoke all on table public.activity_log
from public, anon, authenticated, service_role;

comment on table ceit_connect_private.activity_type_catalog is
  'Batch B semantic activity contract. Stage 2 writers validate payload keys against this private catalog.';
comment on column public.activity_log.task_title_snapshot is
  '30-day exception: only a never-confidential task_deleted row may retain a title; the Stage 2 writer proves the full retained history first.';
comment on constraint activity_log_event_name_snapshot_check on public.activity_log is
  '30-day exception: only event_deleted may retain an optional 1-150 character event name inside the protected payload.';
comment on function ceit_connect_private.activity_event_status_visible_for_user(text, uuid) is
  'Mirrors effective events_select exactly: authenticated callers see non-Draft; active Admins and Co-Admins also see Draft. list_activity_log separately rejects inactive/profile-less callers.';

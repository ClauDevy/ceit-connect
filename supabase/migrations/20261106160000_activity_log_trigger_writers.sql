-- Phase 4B Batch B, Stage 2A: validated semantic writer and trigger-backed
-- task, leave, volunteer, people, and officer-invitation activity.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Batch B Stage 2A must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

create function ceit_connect_private.write_activity(
  p_activity_type text,
  p_actor_kind text,
  p_actor_id uuid,
  p_task_id uuid,
  p_event_id uuid,
  p_subject_user_id uuid,
  p_task_was_confidential boolean,
  p_task_title_snapshot text,
  p_changes jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_catalog ceit_connect_private.activity_type_catalog%rowtype;
  v_activity_id uuid;
  v_phase_value text;
begin
  select catalog.* into v_catalog
  from ceit_connect_private.activity_type_catalog as catalog
  where catalog.activity_type = p_activity_type;

  if not found
     or p_actor_kind not in ('user', 'system', 'unavailable')
     or (p_actor_kind = 'user') is distinct from (p_actor_id is not null)
     or pg_catalog.jsonb_typeof(p_changes) is distinct from 'object'
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(p_changes) as supplied(payload_key)
       where not supplied.payload_key = any(v_catalog.allowed_payload_keys)
     ) then
    raise exception using errcode = 'CAL03', message = 'The activity payload is invalid.';
  end if;

  if v_catalog.subject_kind = 'phase' then
    for v_phase_value in
      select phase_value
      from (values
        (p_changes ->> 'phase'),
        (p_changes ->> 'old_phase'),
        (p_changes ->> 'new_phase')
      ) as phase_values(phase_value)
      where phase_value is not null
    loop
      if pg_catalog.char_length(v_phase_value) not between 1 and 100 then
        raise exception using errcode = 'CAL03', message = 'The activity payload is invalid.';
      end if;
    end loop;
  end if;

  insert into public.activity_log (
    task_id, user_id, actor_kind, subject_kind, activity_type, event_id,
    subject_user_id, task_was_confidential, task_title_snapshot, action, changes
  ) values (
    p_task_id, p_actor_id, p_actor_kind, v_catalog.subject_kind,
    v_catalog.activity_type, p_event_id, p_subject_user_id,
    p_task_was_confidential, p_task_title_snapshot,
    v_catalog.broad_action, p_changes
  )
  returning id into v_activity_id;

  return v_activity_id;
end;
$$;

alter function ceit_connect_private.write_activity(text,text,uuid,uuid,uuid,uuid,boolean,text,jsonb)
owner to postgres;
revoke all on function ceit_connect_private.write_activity(text,text,uuid,uuid,uuid,uuid,boolean,text,jsonb)
from public, anon, authenticated, service_role;

create or replace function public.log_task_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_actor_kind text;
  v_writer text := coalesce(pg_catalog.current_setting('ceit_connect.task_assignee_writer', true), '');
  v_added uuid[] := '{}'::uuid[];
  v_removed uuid[] := '{}'::uuid[];
  v_changed_fields text[] := '{}'::text[];
  v_evidence record;
  v_evidence_count bigint := 0;
  v_evidence_has_confidential boolean := false;
  v_evidence_malformed boolean := false;
  v_task_was_confidential boolean;
  v_title_snapshot text;
  v_wrote_semantic boolean := false;
  v_assignee_role_changed boolean := false;
  v_phase_change_is_rename boolean := false;
  v_phase_renames jsonb;
  v_new_comparable jsonb;
  v_old_comparable jsonb;
  v_new_other jsonb;
  v_old_other jsonb;
begin
  if tg_op = 'DELETE' then
    v_actor_id := coalesce(auth.uid(), ceit_connect_private.event_delete_actor_id(old.event_id));
  else
    v_actor_id := auth.uid();
  end if;
  v_actor_kind := case when v_actor_id is null then 'unavailable' else 'user' end;

  if tg_op = 'INSERT' then
    perform ceit_connect_private.write_activity(
      'task_created', v_actor_kind, v_actor_id, new.id, new.event_id, null,
      new.is_confidential, null,
      pg_catalog.jsonb_build_object('event_id', new.event_id, 'committee_id', new.committee_id)
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    for v_evidence in
      select sibling.* from public.activity_log as sibling where sibling.task_id = old.id
    loop
      v_evidence_count := v_evidence_count + 1;
      if v_evidence.activity_type is not null then
        if v_evidence.subject_kind is distinct from 'task'
           or v_evidence.task_was_confidential is null then
          v_evidence_malformed := true;
        elsif v_evidence.task_was_confidential then
          v_evidence_has_confidential := true;
        end if;
      elsif v_evidence.action = 'UPDATE' then
        if pg_catalog.jsonb_typeof(v_evidence.changes -> 'old') is distinct from 'object'
           or pg_catalog.jsonb_typeof(v_evidence.changes -> 'new') is distinct from 'object'
           or v_evidence.changes -> 'old' ->> 'id' is distinct from old.id::text
           or v_evidence.changes -> 'new' ->> 'id' is distinct from old.id::text
           or pg_catalog.jsonb_typeof(v_evidence.changes -> 'old' -> 'is_confidential') is distinct from 'boolean'
           or pg_catalog.jsonb_typeof(v_evidence.changes -> 'new' -> 'is_confidential') is distinct from 'boolean' then
          v_evidence_malformed := true;
        elsif v_evidence.changes -> 'old' -> 'is_confidential' = 'true'::jsonb
           or v_evidence.changes -> 'new' -> 'is_confidential' = 'true'::jsonb then
          v_evidence_has_confidential := true;
        end if;
      elsif pg_catalog.jsonb_typeof(v_evidence.changes) is distinct from 'object'
         or v_evidence.changes ->> 'id' is distinct from old.id::text
         or pg_catalog.jsonb_typeof(v_evidence.changes -> 'is_confidential') is distinct from 'boolean' then
        v_evidence_malformed := true;
      elsif v_evidence.changes -> 'is_confidential' = 'true'::jsonb then
        v_evidence_has_confidential := true;
      end if;
    end loop;

    v_task_was_confidential := old.is_confidential
      or v_evidence_has_confidential
      or v_evidence_malformed;
    v_title_snapshot := case
      when old.is_confidential is false
       and v_evidence_count > 0
       and not v_evidence_has_confidential
       and not v_evidence_malformed then old.title
      else null
    end;
    perform ceit_connect_private.write_activity(
      'task_deleted', v_actor_kind, v_actor_id, old.id, old.event_id, null,
      v_task_was_confidential, v_title_snapshot,
      pg_catalog.jsonb_build_object('event_id', old.event_id, 'committee_id', old.committee_id)
    );
    return old;
  end if;

  v_new_comparable := pg_catalog.to_jsonb(new) - 'sort_order' - 'updated_at';
  v_old_comparable := pg_catalog.to_jsonb(old) - 'sort_order' - 'updated_at';
  if new.phase is distinct from old.phase then
    begin
      v_phase_renames := nullif(
        pg_catalog.current_setting('ceit_connect.activity_phase_renames', true), ''
      )::jsonb;
      if pg_catalog.jsonb_typeof(v_phase_renames) = 'array' then
        select exists(
          select 1 from pg_catalog.jsonb_array_elements(v_phase_renames) pair(value)
          where pg_catalog.jsonb_typeof(pair.value) = 'object'
            and pair.value ->> 'from' = public.canonical_task_phase(old.phase)
            and pair.value ->> 'to' = public.canonical_task_phase(new.phase)
        ) into v_phase_change_is_rename;
      end if;
    exception when others then
      v_phase_change_is_rename := false;
    end;
  end if;
  if v_phase_change_is_rename then
    v_new_comparable := v_new_comparable - 'phase';
    v_old_comparable := v_old_comparable - 'phase';
  end if;
  if v_new_comparable is not distinct from v_old_comparable then
    return new;
  end if;

  select coalesce(pg_catalog.array_agg(person_id order by person_id), '{}'::uuid[])
  into v_added
  from (
    select person_id from pg_catalog.unnest(new.primary_assignees || new.assist_assignees) as added(person_id)
    except
    select person_id from pg_catalog.unnest(old.primary_assignees || old.assist_assignees) as prior(person_id)
  ) as additions;
  select coalesce(pg_catalog.array_agg(person_id order by person_id), '{}'::uuid[])
  into v_removed
  from (
    select person_id from pg_catalog.unnest(old.primary_assignees || old.assist_assignees) as prior(person_id)
    except
    select person_id from pg_catalog.unnest(new.primary_assignees || new.assist_assignees) as remaining(person_id)
  ) as removals;
  select exists(
    select 1
    from (
      select person_id from pg_catalog.unnest(old.primary_assignees || old.assist_assignees) prior(person_id)
      intersect
      select person_id from pg_catalog.unnest(new.primary_assignees || new.assist_assignees) current_people(person_id)
    ) retained
    where (retained.person_id = any(old.primary_assignees))
      is distinct from (retained.person_id = any(new.primary_assignees))
  ) into v_assignee_role_changed;
  v_assignee_role_changed := v_assignee_role_changed or (
    pg_catalog.cardinality(v_added) = 0
    and pg_catalog.cardinality(v_removed) = 0
    and (
      new.primary_assignees is distinct from old.primary_assignees
      or new.assist_assignees is distinct from old.assist_assignees
    )
  );

  if pg_catalog.cardinality(v_added) > 0 then
    perform ceit_connect_private.write_activity(
      'task_assigned', v_actor_kind, v_actor_id, new.id, new.event_id, null,
      new.is_confidential, null,
      pg_catalog.jsonb_build_object('event_id', new.event_id, 'committee_id', new.committee_id, 'user_ids', pg_catalog.to_jsonb(v_added))
    );
    v_wrote_semantic := true;
  end if;
  if pg_catalog.cardinality(v_removed) > 0 then
    if v_actor_id is not null and v_actor_id = any(v_removed) then
      perform ceit_connect_private.write_activity(
        'task_left', v_actor_kind, v_actor_id, new.id, new.event_id, null,
        new.is_confidential, null,
        pg_catalog.jsonb_build_object('event_id', new.event_id, 'committee_id', new.committee_id, 'user_id', v_actor_id)
      );
      v_wrote_semantic := true;
      v_removed := pg_catalog.array_remove(v_removed, v_actor_id);
    end if;
    if pg_catalog.cardinality(v_removed) > 0 then
      perform ceit_connect_private.write_activity(
        'task_unassigned', v_actor_kind, v_actor_id, new.id, new.event_id, null,
        new.is_confidential, null,
        pg_catalog.jsonb_build_object('event_id', new.event_id, 'committee_id', new.committee_id, 'user_ids', pg_catalog.to_jsonb(v_removed))
      );
      v_wrote_semantic := true;
    end if;
  end if;

  if v_assignee_role_changed then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'assignees');
  end if;

  if new.status is distinct from old.status then
    perform ceit_connect_private.write_activity(
      'task_status_changed', v_actor_kind, v_actor_id, new.id, new.event_id, null,
      new.is_confidential, null,
      pg_catalog.jsonb_build_object('event_id', new.event_id, 'committee_id', new.committee_id, 'old_status', old.status, 'new_status', new.status)
    );
    v_wrote_semantic := true;
  end if;
  if new.is_confidential is distinct from old.is_confidential then
    perform ceit_connect_private.write_activity(
      'task_confidentiality_changed', v_actor_kind, v_actor_id, new.id, new.event_id, null,
      old.is_confidential or new.is_confidential, null,
      pg_catalog.jsonb_build_object('event_id', new.event_id, 'committee_id', new.committee_id, 'old_confidential', old.is_confidential, 'new_confidential', new.is_confidential)
    );
    v_wrote_semantic := true;
  end if;
  if new.request_backup is distinct from old.request_backup then
    perform ceit_connect_private.write_activity(
      case when new.request_backup then 'task_backup_requested' else 'task_backup_cancelled' end,
      v_actor_kind, v_actor_id, new.id, new.event_id, null, new.is_confidential, null,
      pg_catalog.jsonb_build_object('event_id', new.event_id, 'committee_id', new.committee_id)
    );
    v_wrote_semantic := true;
  end if;

  if new.title is distinct from old.title then v_changed_fields := pg_catalog.array_append(v_changed_fields, 'title'); end if;
  if new.description is distinct from old.description then v_changed_fields := pg_catalog.array_append(v_changed_fields, 'description'); end if;
  if new.phase is distinct from old.phase and not v_phase_change_is_rename then v_changed_fields := pg_catalog.array_append(v_changed_fields, 'phase'); end if;
  if new.committee_id is distinct from old.committee_id then v_changed_fields := pg_catalog.array_append(v_changed_fields, 'committee'); end if;
  if new.priority is distinct from old.priority then v_changed_fields := pg_catalog.array_append(v_changed_fields, 'priority'); end if;
  if new.task_type is distinct from old.task_type then v_changed_fields := pg_catalog.array_append(v_changed_fields, 'task_type'); end if;
  if new.due_date is distinct from old.due_date or new.call_time is distinct from old.call_time or new.end_time is distinct from old.end_time then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'schedule');
  end if;
  if new.depends_on_task_id is distinct from old.depends_on_task_id then v_changed_fields := pg_catalog.array_append(v_changed_fields, 'dependency'); end if;
  if new.allowed_viewers is distinct from old.allowed_viewers and new.is_confidential is not distinct from old.is_confidential then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'visibility');
  end if;
  v_new_other := v_new_comparable
    - 'id' - 'title' - 'description' - 'phase' - 'committee_id' - 'priority'
    - 'task_type' - 'due_date' - 'call_time' - 'end_time' - 'depends_on_task_id'
    - 'allowed_viewers' - 'is_confidential' - 'status' - 'request_backup'
    - 'primary_assignees' - 'assist_assignees';
  v_old_other := v_old_comparable
    - 'id' - 'title' - 'description' - 'phase' - 'committee_id' - 'priority'
    - 'task_type' - 'due_date' - 'call_time' - 'end_time' - 'depends_on_task_id'
    - 'allowed_viewers' - 'is_confidential' - 'status' - 'request_backup'
    - 'primary_assignees' - 'assist_assignees';
  if v_new_other is distinct from v_old_other then
    v_changed_fields := pg_catalog.array_append(v_changed_fields, 'other');
  end if;
  if pg_catalog.cardinality(v_changed_fields) > 0 then
    perform ceit_connect_private.write_activity(
      'task_updated', v_actor_kind, v_actor_id, new.id, new.event_id, null,
      old.is_confidential or new.is_confidential, null,
      pg_catalog.jsonb_build_object('event_id', new.event_id, 'committee_id', new.committee_id, 'changed_fields', pg_catalog.to_jsonb(v_changed_fields))
    );
    v_wrote_semantic := true;
  end if;
  if not v_wrote_semantic and v_new_comparable is distinct from v_old_comparable then
    perform ceit_connect_private.write_activity(
      'task_updated', v_actor_kind, v_actor_id, new.id, new.event_id, null,
      old.is_confidential or new.is_confidential, null,
      pg_catalog.jsonb_build_object(
        'event_id', new.event_id, 'committee_id', new.committee_id,
        'changed_fields', pg_catalog.jsonb_build_array('other')
      )
    );
  end if;
  return new;
end;
$$;

alter function public.log_task_activity() owner to postgres;
revoke all on function public.log_task_activity() from public, anon, authenticated, service_role, ceit_event_delete_executor;

create function ceit_connect_private.log_task_leave_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks%rowtype;
  v_activity_type text;
  v_actor_id uuid;
  v_actor_kind text;
begin
  select task_row.* into v_task from public.tasks as task_row where task_row.id = new.task_id;
  if not found then return new; end if;
  if tg_op = 'INSERT' then
    v_activity_type := 'task_leave_requested';
    v_actor_id := coalesce(auth.uid(), new.requester_id);
  elsif new.status is distinct from old.status then
    v_activity_type := case new.status
      when 'approved' then 'task_leave_approved'
      when 'denied' then 'task_leave_rejected'
      when 'cancelled' then 'task_leave_cancelled'
    end;
    v_actor_id := coalesce(new.resolved_by, auth.uid());
  end if;
  if v_activity_type is null then return new; end if;
  v_actor_kind := case when v_actor_id is null then 'unavailable' else 'user' end;
  perform ceit_connect_private.write_activity(
    v_activity_type, v_actor_kind, v_actor_id, v_task.id, v_task.event_id, null,
    v_task.is_confidential, null,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'event_id', v_task.event_id, 'committee_id', v_task.committee_id,
      'request_id', new.id, 'requester_id', new.requester_id,
      'resolver_id', new.resolved_by
    )) || case
      when v_activity_type = 'task_leave_cancelled' and new.stale_reason is not null
        then pg_catalog.jsonb_build_object('reason_code', new.stale_reason)
      else '{}'::jsonb
    end
  );
  return new;
end;
$$;
alter function ceit_connect_private.log_task_leave_activity() owner to postgres;
revoke all on function ceit_connect_private.log_task_leave_activity() from public, anon, authenticated, service_role;

create trigger task_leave_requests_z9_activity_log
after insert or update on public.task_leave_requests
for each row execute function ceit_connect_private.log_task_leave_activity();

create function ceit_connect_private.log_task_volunteer_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_task public.tasks%rowtype;
begin
  select task_row.* into v_task from public.tasks as task_row where task_row.id = new.task_id;
  if found then
    perform ceit_connect_private.write_activity(
      'task_volunteered', 'user', new.user_id, v_task.id, v_task.event_id, null,
      v_task.is_confidential, null,
      pg_catalog.jsonb_build_object('event_id', v_task.event_id, 'committee_id', v_task.committee_id, 'user_id', new.user_id)
    );
  end if;
  return new;
end;
$$;
alter function ceit_connect_private.log_task_volunteer_activity() owner to postgres;
revoke all on function ceit_connect_private.log_task_volunteer_activity() from public, anon, authenticated, service_role;

create trigger task_volunteers_z9_activity_log
after insert on public.task_volunteers
for each row execute function ceit_connect_private.log_task_volunteer_activity();

create function ceit_connect_private.log_user_lifecycle_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_writer text := coalesce(pg_catalog.current_setting('ceit_connect.officer_writer', true), '');
  v_former_writer text := coalesce(pg_catalog.current_setting('ceit_connect.former_member_writer', true), '');
  v_activity_type text;
  v_actor_id uuid := auth.uid();
  v_actor_kind text;
  v_old_committee uuid;
  v_new_committee uuid;
  v_target_role text;
begin
  if tg_op = 'INSERT' then
    v_activity_type := case when new.role in ('Admin', 'Co-Admin') then 'officer_added' else 'member_invited' end;
    v_old_committee := null; v_new_committee := new.committee_id; v_target_role := new.role;
  else
    if v_former_writer = 'anonymize_former_member' and new.anonymized_at is not null and old.anonymized_at is null then
      v_activity_type := 'person_removed';
      v_target_role := old.role;
    elsif new.role is distinct from old.role then
      v_activity_type := case
        when v_writer = 'step_down_as_admin' then 'admin_stepped_down'
        when new.role = 'Admin' then 'appointed_admin'
        when new.role = 'Co-Admin' then 'appointed_coadmin'
        when new.role = 'Member' then 'returned_to_member'
      end;
      v_target_role := new.role;
    elsif new.is_active is distinct from old.is_active then
      v_activity_type := case when new.is_active then 'person_reactivated' else 'person_deactivated' end;
      v_target_role := new.role;
    elsif new.committee_id is distinct from old.committee_id then
      v_activity_type := 'committee_changed';
      v_target_role := new.role;
    else
      return new;
    end if;
    v_old_committee := old.committee_id; v_new_committee := new.committee_id;
  end if;
  v_actor_kind := case when v_actor_id is null then 'unavailable' else 'user' end;
  perform ceit_connect_private.write_activity(
    v_activity_type, v_actor_kind, v_actor_id, null, null, new.id, null, null,
    pg_catalog.jsonb_build_object(
      'old_committee_id', v_old_committee,
      'new_committee_id', v_new_committee,
      'target_role', v_target_role
    )
  );
  return new;
end;
$$;
alter function ceit_connect_private.log_user_lifecycle_activity() owner to postgres;
revoke all on function ceit_connect_private.log_user_lifecycle_activity() from public, anon, authenticated, service_role;

create trigger users_z9_activity_log
after insert or update on public.users
for each row execute function ceit_connect_private.log_user_lifecycle_activity();

create function ceit_connect_private.log_officer_invite_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_activity_type text;
  v_actor_id uuid;
  v_actor_kind text;
begin
  if tg_op = 'INSERT' then
    v_activity_type := 'officer_invited';
    v_actor_id := coalesce(auth.uid(), new.invited_by);
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_activity_type := 'invitation_cancelled';
    v_actor_id := auth.uid();
  else
    return new;
  end if;
  v_actor_kind := case when v_actor_id is null then 'unavailable' else 'user' end;
  perform ceit_connect_private.write_activity(
    v_activity_type, v_actor_kind, v_actor_id, null, null, new.auth_user_id, null, null,
    pg_catalog.jsonb_build_object(
      'old_committee_id', null,
      'new_committee_id', new.committee_id,
      'target_role', new.officer_role,
      'invite_id', new.id
    )
  );
  return new;
end;
$$;
alter function ceit_connect_private.log_officer_invite_activity() owner to postgres;
revoke all on function ceit_connect_private.log_officer_invite_activity() from public, anon, authenticated, service_role;

create trigger officer_invites_z9_activity_log
after insert or update on public.officer_invites
for each row execute function ceit_connect_private.log_officer_invite_activity();

revoke all on table public.activity_log from public, anon, authenticated, service_role;

comment on function ceit_connect_private.write_activity(text,text,uuid,uuid,uuid,uuid,boolean,text,jsonb) is
  'Private Batch B semantic insert boundary: catalog keys, actor shape, subject shape, snapshot constraints, and 100-character protected phase text are validated before insert.';

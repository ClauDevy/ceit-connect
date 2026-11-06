-- Batch A: persist one event-wide phase order and make every reader agree.
--
-- Deferred maintenance mechanism (intentional):
-- 1. A DEFERRABLE INITIALLY DEFERRED constraint trigger queues changed event
--    ids for INSERT/DELETE and real event_id/phase changes.
-- 2. At end of transaction, the trigger creates a transaction-private pg_temp
--    seen table. INSERT ... ON CONFLICT DO NOTHING elects exactly one firing
--    per event; the other row firings return without reconciling.
-- 3. The elected firing first locks the surviving event row FOR SHARE, then
--    takes task_dependency_lock_key(event_id), matching Step 10's
--    event-row -> event-advisory -> task order. Every task writer already owns
--    the event FOR SHARE through the archive guard, so this is re-entrant and
--    deliberately avoids a deadlock-prone SHARE -> UPDATE lock upgrade.
-- 4. If the event row no longer exists, the firing returns before any advisory
--    lock or reconciliation. Batch 13d event-deletion cascades therefore do no
--    phase-maintenance work.

create table ceit_connect_private.event_phase_positions (
  event_id uuid not null references public.events(id) on delete cascade,
  phase_key text not null,
  position bigint not null,
  primary key (event_id, phase_key),
  constraint event_phase_positions_position_positive check (position > 0),
  constraint event_phase_positions_canonical check (
    phase_key = public.canonical_task_phase(phase_key)
  ),
  constraint event_phase_positions_event_position_key
    unique (event_id, position) deferrable initially immediate
);

revoke all on table ceit_connect_private.event_phase_positions
from public, anon, authenticated, service_role;

create function ceit_connect_private.reconcile_event_phase_positions(
  p_event_id uuid,
  p_requested_order text[] default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actual text[];
  v_requested text[];
begin
  if p_event_id is null then
    raise exception using errcode = '22023', message = 'An event is required.';
  end if;

  select coalesce(array_agg(phase_key order by first_sort_order, first_task_id), '{}'::text[])
  into v_actual
  from (
    select public.canonical_task_phase(task_row.phase) as phase_key,
      min(task_row.sort_order) as first_sort_order,
      (array_agg(task_row.id order by task_row.sort_order, task_row.id))[1] as first_task_id
    from public.tasks as task_row
    where task_row.event_id = p_event_id
    group by public.canonical_task_phase(task_row.phase)
  ) as phases;

  delete from ceit_connect_private.event_phase_positions as stored
  where stored.event_id = p_event_id
    and not (stored.phase_key = any(v_actual));

  insert into ceit_connect_private.event_phase_positions(event_id, phase_key, position)
  select p_event_id, actual.phase_key,
    (coalesce((select max(position) from ceit_connect_private.event_phase_positions where event_id = p_event_id), 0)
      + actual.ordinality::bigint * 1024)
  from unnest(v_actual) with ordinality as actual(phase_key, ordinality)
  where not exists (
    select 1 from ceit_connect_private.event_phase_positions as stored
    where stored.event_id = p_event_id and stored.phase_key = actual.phase_key
  );

  if p_requested_order is not null then
    select coalesce(array_agg(public.canonical_task_phase(value) order by ordinality), '{}'::text[])
    into v_requested
    from unnest(p_requested_order) with ordinality as requested(value, ordinality);

    if cardinality(v_requested) <> cardinality(v_actual)
       or cardinality(v_requested) <> (select count(distinct value) from unnest(v_requested) as item(value))
       or exists (select 1 from unnest(v_actual) as item(value) where not (item.value = any(v_requested))) then
      raise exception using errcode = 'CCP06', message = 'The phase order changed. Refresh and try again.';
    end if;

    -- The definer has an empty search_path, so the constraint target must be
    -- schema-qualified. It is deferred only for this transaction's renumber.
    set constraints ceit_connect_private.event_phase_positions_event_position_key deferred;
    update ceit_connect_private.event_phase_positions as stored
    set position = requested.ordinality::bigint * 1024
    from unnest(v_requested) with ordinality as requested(phase_key, ordinality)
    where stored.event_id = p_event_id and stored.phase_key = requested.phase_key;
  end if;
end;
$$;

alter function ceit_connect_private.reconcile_event_phase_positions(uuid,text[]) owner to postgres;
revoke all on function ceit_connect_private.reconcile_event_phase_positions(uuid,text[])
from public, anon, authenticated, service_role;

-- Backfill the exact current first-seen order: task sort_order, then id.
insert into ceit_connect_private.event_phase_positions(event_id, phase_key, position)
select event_id, phase_key, row_number() over (partition by event_id order by first_sort_order, first_task_id)::bigint * 1024
from (
  select task_row.event_id,
    public.canonical_task_phase(task_row.phase) as phase_key,
    min(task_row.sort_order) as first_sort_order,
    (array_agg(task_row.id order by task_row.sort_order, task_row.id))[1] as first_task_id
  from public.tasks as task_row
  group by task_row.event_id, public.canonical_task_phase(task_row.phase)
) as phases;

create function ceit_connect_private.defer_event_phase_reconciliation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id uuid := coalesce(new.event_id, old.event_id);
begin
  if tg_op = 'UPDATE'
     and new.event_id is not distinct from old.event_id
     and public.canonical_task_phase(new.phase) is not distinct from public.canonical_task_phase(old.phase) then
    return null;
  end if;

  create temporary table if not exists pg_temp.batch_a_phase_events_seen (
    event_id uuid primary key
  ) on commit drop;

  insert into pg_temp.batch_a_phase_events_seen(event_id)
  values (v_event_id)
  on conflict do nothing;
  if not found then return null; end if;

  perform 1 from public.events as event_row where event_row.id = v_event_id for share;
  if not found then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(public.task_dependency_lock_key(v_event_id));
  perform ceit_connect_private.reconcile_event_phase_positions(v_event_id, null);
  return null;
end;
$$;

alter function ceit_connect_private.defer_event_phase_reconciliation() owner to postgres;
revoke all on function ceit_connect_private.defer_event_phase_reconciliation()
from public, anon, authenticated, service_role;

create constraint trigger tasks_z9_reconcile_event_phase_positions
after insert or delete or update of event_id, phase on public.tasks
deferrable initially deferred
for each row execute function ceit_connect_private.defer_event_phase_reconciliation();

create function public.list_event_phase_order(p_event_id uuid)
returns table (phase_key text, "position" bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select stored.phase_key, stored.position
  from ceit_connect_private.event_phase_positions as stored
  join public.events as event_row on event_row.id = stored.event_id
  join public.users as caller on caller.id = auth.uid() and caller.is_active
  where stored.event_id = p_event_id
    and (
      event_row.status = 'Active'
      or (event_row.status = 'Draft' and caller.role in ('Admin','Co-Admin'))
      or (
        event_row.status = 'Archived'
        and exists (
          select 1
          from public.tasks as task_row
          where task_row.event_id = stored.event_id
            and public.canonical_task_phase(task_row.phase) = stored.phase_key
            and public.task_content_access_for_user(task_row.id, auth.uid()) = 'real'
        )
      )
    )
  order by stored.position, stored.phase_key
$$;

alter function public.list_event_phase_order(uuid) owner to postgres;
revoke all on function public.list_event_phase_order(uuid) from public, anon, authenticated;
grant execute on function public.list_event_phase_order(uuid) to authenticated;

-- Wrap the latest readers. Their prior bodies remain authoritative for row
-- visibility, masking, completion, and within-phase lane order.
alter function public.list_draft_event_editor_tasks(uuid) rename to list_draft_event_editor_tasks_pre_batch_a;
revoke all on function public.list_draft_event_editor_tasks_pre_batch_a(uuid) from public,anon,authenticated,service_role;
create function public.list_draft_event_editor_tasks(p_event_id uuid)
returns table(out_task_id uuid,out_phase text,out_status text,out_title text,out_description text,out_priority text,out_task_type text,out_due_date timestamptz,out_call_time timestamptz,out_end_time timestamptz,out_committee_id uuid,out_committee_name text,out_primary_assignees jsonb,out_assist_assignees jsonb,out_is_masked boolean,out_is_editable boolean,out_phase_complete boolean,out_can_reopen boolean,out_updated_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select prior.* from public.list_draft_event_editor_tasks_pre_batch_a(p_event_id) as prior
  left join ceit_connect_private.event_phase_positions pos
    on pos.event_id=p_event_id and pos.phase_key=public.canonical_task_phase(prior.out_phase)
  join public.tasks task_row on task_row.id=prior.out_task_id
  order by pos.position nulls last, task_row.sort_order, task_row.id
$$;
alter function public.list_draft_event_editor_tasks(uuid) owner to postgres;
revoke all on function public.list_draft_event_editor_tasks(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_draft_event_editor_tasks(uuid) to authenticated;

alter function public.list_event_board_tasks(uuid,uuid) rename to list_event_board_tasks_pre_batch_a;
revoke all on function public.list_event_board_tasks_pre_batch_a(uuid,uuid) from public,anon,authenticated,service_role;
create function public.list_event_board_tasks(p_event_id uuid,p_committee_id uuid default null)
returns table(id uuid,title text,phase text,status text,effective_priority text,due_date timestamptz,committee_id uuid,committee_name text,primary_assignees jsonb,assist_assignees jsonb,is_backlog boolean,is_masked boolean,phase_complete boolean,can_reopen boolean,updated_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select prior.* from public.list_event_board_tasks_pre_batch_a(p_event_id,p_committee_id) as prior
  left join ceit_connect_private.event_phase_positions pos
    on pos.event_id=p_event_id and pos.phase_key=public.canonical_task_phase(prior.phase)
  join public.tasks task_row on task_row.id=prior.id
  order by pos.position nulls last, task_row.sort_order, task_row.id
$$;
alter function public.list_event_board_tasks(uuid,uuid) owner to postgres;
revoke all on function public.list_event_board_tasks(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_event_board_tasks(uuid,uuid) to authenticated;

-- Extend the current eleven-argument boundary without changing its signature.
alter function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)
rename to edit_event_with_tasks_pre_batch_a;
revoke all on function public.edit_event_with_tasks_pre_batch_a(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb)
from public,anon,authenticated,service_role;
create function public.edit_event_with_tasks(
  p_event_id uuid,p_expected_updated_at timestamptz,p_name text,p_description text,
  p_start_date date,p_end_date date,p_status text,p_tasks_to_add jsonb default '[]'::jsonb,
  p_tasks_to_update jsonb default '[]'::jsonb,p_task_ids_to_delete uuid[] default '{}'::uuid[],
  p_phase_actions jsonb default '[]'::jsonb
) returns timestamptz language plpgsql volatile security definer set search_path=''
as $$
declare
  v_action jsonb;
  v_order text[];
  v_filtered jsonb;
  v_result timestamptz;
  v_status text;
  v_renames jsonb := '[]'::jsonb;
  v_rename jsonb;
begin
  if not exists(select 1 from public.users where id=auth.uid() and is_active and role in ('Admin','Co-Admin')) then
    raise exception using errcode='42501',message='Only active Admins and Co-Admins can edit events.';
  end if;
  select status into v_status from public.events where id=p_event_id;
  select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb) into v_filtered
  from jsonb_array_elements(coalesce(p_phase_actions,'[]'::jsonb)) with ordinality as action(value,ordinality)
  where value->>'type' is distinct from 'reorder';
  for v_action in select value from jsonb_array_elements(coalesce(p_phase_actions,'[]'::jsonb)) as action(value)
  loop
    if v_action->>'type' in ('rename','delete')
       and public.canonical_task_phase(v_action->>'phase')='Unphased' then
      raise exception using errcode='CCP06',message='Unphased can be moved but cannot be renamed or removed.';
    end if;
    if v_action->>'type'='reorder' then
      if v_order is not null or jsonb_typeof(v_action->'phases') <> 'array' then
        raise exception using errcode='22023',message='Phase actions are invalid.';
      end if;
      if v_status='Archived' then
        raise exception using errcode='CCP06',message='Archived event phases cannot be reordered.';
      end if;
      select array_agg(value order by ordinality) into v_order
      from jsonb_array_elements_text(v_action->'phases') with ordinality as item(value,ordinality);
    end if;
  end loop;

  -- Snapshot rename positions before the prior writer mutates task phases.
  -- A rename inherits its old position; a merge keeps the destination's.
  select coalesce(jsonb_agg(jsonb_build_object(
    'phase',public.canonical_task_phase(action.value->>'phase'),
    'next_phase',public.canonical_task_phase(action.value->>'next_phase'),
    'position',stored.position
  ) order by action.ordinality),'[]'::jsonb)
  into v_renames
  from jsonb_array_elements(coalesce(p_phase_actions,'[]'::jsonb))
    with ordinality as action(value,ordinality)
  join ceit_connect_private.event_phase_positions stored
    on stored.event_id=p_event_id
   and stored.phase_key=public.canonical_task_phase(action.value->>'phase')
  where action.value->>'type'='rename';

  -- The prior editor intentionally writes tasks before the event row. Expose
  -- the proposed end date only to trusted trigger executions in this call.
  -- The four-part context is exact-writer + event-bound + explicit is-set +
  -- value; an empty value therefore means "set to no end", not "not set".
  -- Both exit paths clear it immediately after the prior writer returns.
  perform set_config('ceit_connect.event_end_override_writer','edit_event_with_tasks',true);
  perform set_config('ceit_connect.event_end_override_event_id',p_event_id::text,true);
  perform set_config('ceit_connect.event_end_override_is_set','true',true);
  perform set_config('ceit_connect.event_end_override_value',coalesce(p_end_date::text,''),true);
  begin
    v_result:=public.edit_event_with_tasks_pre_batch_a(p_event_id,p_expected_updated_at,p_name,p_description,p_start_date,p_end_date,p_status,p_tasks_to_add,p_tasks_to_update,p_task_ids_to_delete,v_filtered);
    perform set_config('ceit_connect.event_end_override_writer','',true);
    perform set_config('ceit_connect.event_end_override_event_id','',true);
    perform set_config('ceit_connect.event_end_override_is_set','',true);
    perform set_config('ceit_connect.event_end_override_value','',true);
  exception when others then
    perform set_config('ceit_connect.event_end_override_writer','',true);
    perform set_config('ceit_connect.event_end_override_event_id','',true);
    perform set_config('ceit_connect.event_end_override_is_set','',true);
    perform set_config('ceit_connect.event_end_override_value','',true);
    raise;
  end;

  if jsonb_array_length(v_renames)>0 then
    set constraints ceit_connect_private.event_phase_positions_event_position_key deferred;
    for v_rename in select value from jsonb_array_elements(v_renames) as rename_row(value)
    loop
      if v_rename->>'phase' is distinct from v_rename->>'next_phase' then
        if exists(
          select 1 from ceit_connect_private.event_phase_positions stored
          where stored.event_id=p_event_id and stored.phase_key=v_rename->>'next_phase'
        ) then
          delete from ceit_connect_private.event_phase_positions stored
          where stored.event_id=p_event_id
            and stored.phase_key=v_rename->>'phase'
            and stored.position=(v_rename->>'position')::bigint;
        else
          update ceit_connect_private.event_phase_positions stored
          set phase_key=v_rename->>'next_phase',position=(v_rename->>'position')::bigint
          where stored.event_id=p_event_id
            and stored.phase_key=v_rename->>'phase'
            and stored.position=(v_rename->>'position')::bigint;
        end if;
      end if;
    end loop;
  end if;
  if v_order is not null then perform ceit_connect_private.reconcile_event_phase_positions(p_event_id,v_order); end if;
  return v_result;
end;
$$;
alter function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) owner to postgres;
revoke all on function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.edit_event_with_tasks(uuid,timestamptz,text,text,date,date,text,jsonb,jsonb,uuid[],jsonb) to authenticated;

alter function public.create_event_with_tasks(text,text,date,date,text,jsonb)
rename to create_event_with_tasks_pre_batch_a;
revoke all on function public.create_event_with_tasks_pre_batch_a(text,text,date,date,text,jsonb)
from public,anon,authenticated,service_role;
create function public.create_event_with_tasks(p_name text,p_description text,p_start_date date,p_end_date date,p_status text,p_tasks jsonb)
returns uuid language plpgsql volatile security definer set search_path=''
as $$
declare v_event_id uuid;v_order text[];
begin
  select array_agg(phase_key order by first_ordinality) into v_order
  from (select public.canonical_task_phase(value->>'phase') phase_key,min(ordinality) first_ordinality
    from jsonb_array_elements(p_tasks) with ordinality as task(value,ordinality)
    group by public.canonical_task_phase(value->>'phase')) phases;
  v_event_id:=public.create_event_with_tasks_pre_batch_a(p_name,p_description,p_start_date,p_end_date,p_status,p_tasks);
  perform 1 from public.events where id=v_event_id for update;
  perform pg_advisory_xact_lock(public.task_dependency_lock_key(v_event_id));
  perform ceit_connect_private.reconcile_event_phase_positions(v_event_id,v_order);
  return v_event_id;
end;
$$;
alter function public.create_event_with_tasks(text,text,date,date,text,jsonb) owner to postgres;
revoke all on function public.create_event_with_tasks(text,text,date,date,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_event_with_tasks(text,text,date,date,text,jsonb) to authenticated;

alter function public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb)
rename to create_event_from_archived_template_pre_batch_a;
revoke all on function public.create_event_from_archived_template_pre_batch_a(text,text,date,date,text,uuid,jsonb,jsonb)
from public,anon,authenticated,service_role;
create function public.create_event_from_archived_template(p_name text,p_description text,p_start_date date,p_end_date date,p_status text,p_template_event_id uuid,p_own_tasks jsonb,p_excluded_template_task_ids jsonb)
returns uuid language plpgsql volatile security definer set search_path=''
as $$
declare v_event_id uuid;v_order text[];
begin
  v_event_id:=public.create_event_from_archived_template_pre_batch_a(p_name,p_description,p_start_date,p_end_date,p_status,p_template_event_id,p_own_tasks,p_excluded_template_task_ids);
  perform 1 from public.events where id=v_event_id for update;
  perform pg_advisory_xact_lock(public.task_dependency_lock_key(v_event_id));
  select array_agg(phase_key order by source_position nulls last,first_sort,first_id) into v_order
  from (select public.canonical_task_phase(task_row.phase) phase_key,min(source_pos.position) source_position,
    min(task_row.sort_order) first_sort,(array_agg(task_row.id order by task_row.sort_order,task_row.id))[1] first_id
    from public.tasks task_row
    left join ceit_connect_private.event_phase_positions source_pos
      on source_pos.event_id=p_template_event_id and source_pos.phase_key=public.canonical_task_phase(task_row.phase)
    where task_row.event_id=v_event_id group by public.canonical_task_phase(task_row.phase)) phases;
  perform ceit_connect_private.reconcile_event_phase_positions(v_event_id,v_order);
  return v_event_id;
end;
$$;
alter function public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb) owner to postgres;
revoke all on function public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.create_event_from_archived_template(text,text,date,date,text,uuid,jsonb,jsonb) to authenticated;

alter function public.get_archived_event_template(uuid,date) rename to get_archived_event_template_pre_batch_a;
revoke all on function public.get_archived_event_template_pre_batch_a(uuid,date) from public,anon,authenticated,service_role;
create function public.get_archived_event_template(p_template_event_id uuid,p_new_start_date date)
returns table(template_name text,template_start_date date,tasks jsonb,imported_task_count integer,skipped_confidential_count integer)
language sql stable security definer set search_path=''
as $$
  select prior.template_name,prior.template_start_date,
    coalesce((select jsonb_agg(item.value order by pos.position nulls last,item.ordinality)
      from jsonb_array_elements(prior.tasks) with ordinality item(value,ordinality)
      left join public.tasks source_task on source_task.id=(item.value->>'source_task_id')::uuid
      left join ceit_connect_private.event_phase_positions pos on pos.event_id=p_template_event_id and pos.phase_key=public.canonical_task_phase(source_task.phase)),'[]'::jsonb),
    prior.imported_task_count,prior.skipped_confidential_count
  from public.get_archived_event_template_pre_batch_a(p_template_event_id,p_new_start_date) prior
$$;
alter function public.get_archived_event_template(uuid,date) owner to postgres;
revoke all on function public.get_archived_event_template(uuid,date) from public,anon,authenticated;
grant execute on function public.get_archived_event_template(uuid,date) to authenticated;

create or replace function public.list_home_event_progress(p_event_ids uuid[])
returns table(out_event_id uuid,out_phase_label text,out_progress_percentage integer,out_visible_backup_request_count integer,out_backlog_count integer)
language plpgsql stable security definer set search_path=''
as $$
declare v_caller_id uuid:=auth.uid();
begin
  if p_event_ids is null or cardinality(p_event_ids)=0 or cardinality(p_event_ids)>20 or array_position(p_event_ids,null::uuid) is not null then
    raise exception using errcode='22023',message='Home event progress requires between 1 and 20 non-null event IDs.';
  end if;
  if v_caller_id is null or not exists(select 1 from public.users where id=v_caller_id and is_active) then
    raise exception using errcode='42501',message='An active profile is required.';
  end if;
  return query
  with requested as (select event_id,min(ordinality) request_position from unnest(p_event_ids) with ordinality item(event_id,ordinality) group by event_id),
  visible as (select requested.* from requested join public.events event_row on event_row.id=requested.event_id and event_row.status='Active'),
  task_access as materialized (
    select task_row.event_id,task_row.id task_id,public.canonical_task_phase(task_row.phase) phase_label,
      task_row.status,task_row.primary_assignees,task_row.request_backup,
      public.task_content_access_for_user(task_row.id,v_caller_id) content_access
    from public.tasks task_row join visible on visible.event_id=task_row.event_id
  ),
  summary as materialized (select * from task_access where content_access in ('real','masked')),
  totals as (select visible.event_id,visible.request_position,count(summary.task_id)::integer total_count,count(summary.task_id) filter(where summary.status='Completed')::integer completed_count,
    count(summary.task_id) filter(where summary.content_access='real' and summary.request_backup and summary.status<>'Completed')::integer backup_count,
    count(summary.task_id) filter(where cardinality(summary.primary_assignees)=0 and summary.status<>'Completed')::integer backlog_count
    from visible left join summary on summary.event_id=visible.event_id group by visible.event_id,visible.request_position),
  current_phase as (select distinct on(summary.event_id) summary.event_id,summary.phase_label
    from summary join ceit_connect_private.event_phase_positions pos on pos.event_id=summary.event_id and pos.phase_key=summary.phase_label
    group by summary.event_id,summary.phase_label,pos.position having bool_or(summary.status<>'Completed')
    order by summary.event_id,pos.position)
  select totals.event_id,case when totals.total_count=0 then null when totals.completed_count=totals.total_count then 'All phases complete' else current_phase.phase_label end,
    case when totals.total_count=0 then 0 else round(totals.completed_count::numeric*100/totals.total_count)::integer end,totals.backup_count,totals.backlog_count
  from totals left join current_phase on current_phase.event_id=totals.event_id order by totals.request_position;
end;
$$;
alter function public.list_home_event_progress(uuid[]) owner to postgres;
revoke all on function public.list_home_event_progress(uuid[]) from public,anon,authenticated;
grant execute on function public.list_home_event_progress(uuid[]) to authenticated;

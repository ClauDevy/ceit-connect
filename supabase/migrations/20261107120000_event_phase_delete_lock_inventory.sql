-- Phase 4B Batch B follow-up: register Batch A's event-phase-position FK in
-- the fail-closed event-deletion lock inventory.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'The event deletion inventory follow-up must be applied by postgres; current_user is %.', current_user;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conname = 'event_phase_positions_event_id_fkey'
      and constraint_row.conrelid = 'ceit_connect_private.event_phase_positions'::regclass
      and constraint_row.confrelid = 'public.events'::regclass
      and constraint_row.contype = 'f'
      and constraint_row.confdeltype = 'c'
      and pg_catalog.cardinality(constraint_row.conkey) = 1
      and pg_catalog.cardinality(constraint_row.confkey) = 1
      and (
        select attribute.attname
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = constraint_row.conrelid
          and attribute.attnum = constraint_row.conkey[1]
      ) = 'event_id'
      and (
        select attribute.attname
        from pg_catalog.pg_attribute as attribute
        where attribute.attrelid = constraint_row.confrelid
          and attribute.attnum = constraint_row.confkey[1]
      ) = 'id'
  ) then
    raise exception 'The reviewed event phase-position foreign key is unavailable.';
  end if;
end
$$;

alter table ceit_connect_private.event_delete_fk_lock_list
drop constraint event_delete_fk_lock_list_lock_kind_check;

alter table ceit_connect_private.event_delete_fk_lock_list
add constraint event_delete_fk_lock_list_lock_kind_check
check (lock_kind in ('task_rows', 'task_child_rows', 'event_child_rows'));

insert into ceit_connect_private.event_delete_fk_lock_list (
  constraint_name,
  referencing_schema,
  referencing_table,
  referenced_table,
  lock_kind,
  lock_order
)
values (
  'event_phase_positions_event_id_fkey',
  'ceit_connect_private',
  'event_phase_positions',
  'events',
  'event_child_rows',
  90
);

create or replace function ceit_connect_private.lock_event_delete_descendants(p_event_id uuid)
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
      lock_row.lock_kind,
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
    where lock_row.lock_kind in ('task_child_rows', 'event_child_rows')
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
      if v_fk.lock_kind = 'task_child_rows' then
        execute pg_catalog.format(
          'select 1 from %I.%I as child_row where child_row.%I = any ($1) '
          || 'order by child_row.%I, child_row.ctid for update nowait',
          v_fk.source_schema,
          v_fk.source_table,
          v_fk_column,
          v_fk_column
        )
        using v_task_ids;
      else
        execute pg_catalog.format(
          'select 1 from %I.%I as child_row where child_row.%I = $1 '
          || 'order by child_row.%I, child_row.ctid for update nowait',
          v_fk.source_schema,
          v_fk.source_table,
          v_fk_column,
          v_fk_column
        )
        using p_event_id;
      end if;
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

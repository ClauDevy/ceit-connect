do $$
begin
  if current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'This migration must run as postgres.';
  end if;
end;
$$;

do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as source_class
      on source_class.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_class.relnamespace
    where source_namespace.nspname = 'ceit_connect_private'
      and source_class.relname = 'email_delivery_queue'
      and constraint_row.conname = 'email_delivery_queue_task_id_fkey'
      and constraint_row.contype = 'f'
      and constraint_row.confrelid = 'public.tasks'::regclass
  ) then
    alter table ceit_connect_private.email_delivery_queue
      drop constraint if exists email_delivery_queue_task_id_fkey;
  end if;
end;
$$;

create index if not exists email_delivery_queue_task_id_idx
on ceit_connect_private.email_delivery_queue (task_id);

do $$
declare
  v_actual_count bigint;
  v_expected_count bigint;
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute_row
    where attribute_row.attrelid =
        'ceit_connect_private.email_delivery_queue'::regclass
      and attribute_row.attname = 'task_id'
      and attribute_row.atttypid = 'uuid'::regtype
      and attribute_row.attnotnull
      and not attribute_row.attisdropped
  ) then
    raise exception 'Email delivery queue task_id must remain uuid not null.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_row
    join pg_catalog.pg_attribute as attribute_row
      on attribute_row.attrelid = index_row.indrelid
     and attribute_row.attname = 'task_id'
     and not attribute_row.attisdropped
    where index_row.indrelid =
        'ceit_connect_private.email_delivery_queue'::regclass
      and index_row.indisvalid
      and index_row.indisready
      and not index_row.indisunique
      and not index_row.indisprimary
      and index_row.indpred is null
      and index_row.indexprs is null
      and index_row.indnkeyatts = 1
      and index_row.indnatts = 1
      and index_row.indkey[0] = attribute_row.attnum
  ) then
    raise exception 'Email delivery queue task_id index is unavailable.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    join pg_catalog.pg_class as source_class
      on source_class.oid = constraint_row.conrelid
    join pg_catalog.pg_namespace as source_namespace
      on source_namespace.oid = source_class.relnamespace
    where constraint_row.contype = 'f'
      and source_namespace.nspname = 'ceit_connect_private'
      and (
        source_class.relname::text like 'email\_%' escape '\'
        or source_class.relname = 'user_email_preferences'
      )
      and constraint_row.confrelid in (
        'public.events'::regclass,
        'public.tasks'::regclass
      )
  ) then
    raise exception 'Email tables must not reference public events or tasks.';
  end if;

  select pg_catalog.count(*)
  into v_actual_count
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.contype = 'f'
    and constraint_row.confrelid in (
      'public.events'::regclass,
      'public.tasks'::regclass
    );

  select pg_catalog.count(*)
  into v_expected_count
  from ceit_connect_private.event_delete_fk_lock_list;

  if v_actual_count <> v_expected_count then
    raise exception 'Event deletion foreign-key inventory count mismatch.';
  end if;
end;
$$;

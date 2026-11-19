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

create or replace function ceit_connect_private.purge_email_delivery_history(p_as_of timestamptz)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer := 0;
  v_part integer := 0;
begin
  if session_user <> 'postgres'
     and ceit_connect_private.authenticate_email_sender() is null then
    raise exception using errcode = '42501', message = 'Email sender authentication failed.';
  end if;
  with stale as (
    select queue.id
    from ceit_connect_private.email_delivery_queue as queue
    where (
      queue.state = 'pending'
      and queue.stale_at <= p_as_of
    ) or (
      queue.state = 'leased'
      and queue.lease_expires_at <= p_as_of
      and queue.stale_at <= p_as_of
    )
    order by queue.stale_at, queue.id
    limit 500 for update skip locked
  )
  update ceit_connect_private.email_delivery_queue as queue
  set state = 'stale', terminal_at = p_as_of, terminal_reason = 'stale',
      lease_token = null, lease_expires_at = null, send_guard_until = null,
      updated_at = p_as_of
  from stale where queue.id = stale.id;

  with orphaned as (
    select queue.id
    from ceit_connect_private.email_delivery_queue as queue
    where queue.state = 'pending'
      and not exists (
        select 1
        from public.tasks as task_row
        where task_row.id = queue.task_id
      )
    order by queue.created_at, queue.id
    limit 500 for update skip locked
  )
  update ceit_connect_private.email_delivery_queue as queue
  set state = 'stale', terminal_at = p_as_of, terminal_reason = 'stale',
      lease_token = null, lease_expires_at = null, send_guard_until = null,
      updated_at = p_as_of
  from orphaned where queue.id = orphaned.id;

  with doomed as (
    select queue.id
    from ceit_connect_private.email_delivery_queue as queue
    where queue.state in ('delivered', 'terminal', 'suppressed', 'stale')
      and queue.updated_at < p_as_of - interval '7 days'
    order by queue.updated_at, queue.id
    limit 500 for update skip locked
  )
  delete from ceit_connect_private.email_delivery_queue as queue
  using doomed where queue.id = doomed.id;
  get diagnostics v_deleted = row_count;

  with doomed as (
    select attempt.delivery_id, attempt.attempt_number
    from ceit_connect_private.email_send_attempts as attempt
    where attempt.reserved_at < p_as_of - interval '48 hours'
    order by attempt.reserved_at, attempt.delivery_id, attempt.attempt_number
    limit 500 for update skip locked
  )
  delete from ceit_connect_private.email_send_attempts as attempt
  using doomed
  where attempt.delivery_id = doomed.delivery_id
    and attempt.attempt_number = doomed.attempt_number;
  get diagnostics v_part = row_count;
  v_deleted := v_deleted + v_part;

  with doomed as (
    select run_row.id
    from ceit_connect_private.email_delivery_runs as run_row
    where (
      run_row.finished_at is not null
      and run_row.finished_at < p_as_of - interval '30 days'
    ) or (
      run_row.finished_at is null
      and run_row.started_at < p_as_of - interval '30 days'
    )
    order by coalesce(run_row.finished_at, run_row.started_at), run_row.id
    limit 500 for update skip locked
  )
  delete from ceit_connect_private.email_delivery_runs as run_row
  using doomed where run_row.id = doomed.id;
  get diagnostics v_part = row_count;
  return v_deleted + v_part;
end;
$$;

alter function ceit_connect_private.purge_email_delivery_history(timestamptz)
owner to postgres;
revoke all on function ceit_connect_private.purge_email_delivery_history(timestamptz)
from public, anon, authenticated, service_role;

create or replace function public.claim_email_deliveries(p_limit integer default 10)
returns table (
  out_delivery_id uuid,
  out_lease_token uuid,
  out_run_id uuid,
  out_run_token uuid,
  out_notification_type text,
  out_attempt integer,
  out_lease_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_allowance integer;
  v_used integer;
  v_manila_used integer;
  v_rolling_used integer;
  v_available integer;
  v_claim_limit integer;
  v_run_id uuid := gen_random_uuid();
  v_run_token uuid := gen_random_uuid();
  v_claimed integer := 0;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Email sender authentication failed.';
  end if;
  if p_limit is null or p_limit not between 1 and 10 then
    raise exception using errcode = '22023', message = 'Claim limit must be between 1 and 10.';
  end if;

  perform ceit_connect_private.purge_email_delivery_history(v_now);

  update ceit_connect_private.email_delivery_queue as queue
  set state = 'stale', terminal_at = v_now, terminal_reason = 'stale',
      lease_token = null, lease_expires_at = null, send_guard_until = null,
      updated_at = v_now
  where (queue.state = 'pending' and queue.stale_at <= v_now)
     or (queue.state = 'leased'
         and queue.lease_expires_at <= v_now
         and queue.stale_at <= v_now);

  update ceit_connect_private.email_delivery_queue as queue
  set state = 'pending', lease_token = null, lease_expires_at = null,
      send_guard_until = null, next_attempt_at = v_now, updated_at = v_now
  where queue.state = 'leased'
    and queue.lease_expires_at <= v_now
    and queue.stale_at > v_now
    and queue.attempt_count < 5;

  update ceit_connect_private.email_delivery_queue as queue
  set state = 'terminal', terminal_at = v_now,
      terminal_reason = 'attempts_exhausted', lease_token = null,
      lease_expires_at = null, send_guard_until = null, updated_at = v_now
  where queue.state = 'leased'
    and queue.lease_expires_at <= v_now
    and queue.attempt_count >= 5;

  update ceit_connect_private.email_delivery_queue as queue
  set state = 'suppressed', terminal_at = v_now,
      terminal_reason = 'recipient_ineligible', updated_at = v_now
  where queue.state = 'pending'
    and not exists (
      select 1
      from public.users as profile
      join auth.users as auth_user on auth_user.id = profile.id
      where profile.id = queue.user_id
        and profile.is_active is true
        and profile.anonymized_at is null
        and auth_user.email_confirmed_at is not null
        and auth_user.email is not null
        and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
            pg_catalog.lower(pg_catalog.btrim(profile.email))
        and not exists (
          select 1
          from ceit_connect_private.user_email_preferences as preference
          where preference.user_id = queue.user_id
            and preference.important_updates_enabled is false
        )
    );

  select config.daily_allowance
  into v_allowance
  from ceit_connect_private.email_delivery_config as config
  where config.singleton
  for update;

  select pg_catalog.count(*)::integer
  into v_manila_used
  from ceit_connect_private.email_send_attempts as attempt
  where (attempt.reserved_at at time zone 'Asia/Manila')::date =
        (v_now at time zone 'Asia/Manila')::date;
  select pg_catalog.count(*)::integer
  into v_rolling_used
  from ceit_connect_private.email_send_attempts as attempt
  where attempt.reserved_at > v_now - interval '24 hours';
  v_used := v_manila_used;
  if v_rolling_used > v_used then
    v_used := v_rolling_used;
  end if;
  v_available := v_allowance - v_used;
  if v_available <= 0 then
    insert into ceit_connect_private.email_delivery_runs (
      id, run_token, started_at, finished_at, status, allowance_reached_count
    )
    select v_run_id, v_run_token, v_now, v_now, 'completed', 1
    where not exists (
      select 1
      from ceit_connect_private.email_delivery_runs as run_row
      where run_row.allowance_reached_count = 1
        and run_row.started_at >= pg_catalog.date_trunc('hour', v_now)
        and run_row.started_at < pg_catalog.date_trunc('hour', v_now) + interval '1 hour'
    );
    return;
  end if;
  v_claim_limit := v_available;
  if v_claim_limit > p_limit then
    v_claim_limit := p_limit;
  end if;

  insert into ceit_connect_private.email_delivery_runs (id, run_token, started_at)
  values (v_run_id, v_run_token, v_now);

  return query
  with candidates as materialized (
    select queue.id, gen_random_uuid() as lease_token
    from ceit_connect_private.email_delivery_queue as queue
    join public.tasks as task_row on task_row.id = queue.task_id
    join public.users as profile on profile.id = queue.user_id
    join auth.users as auth_user on auth_user.id = profile.id
    where queue.state = 'pending'
      and queue.next_attempt_at <= v_now
      and queue.stale_at > v_now
      and queue.attempt_count < 5
      and profile.is_active is true
      and profile.anonymized_at is null
      and auth_user.email_confirmed_at is not null
      and auth_user.email is not null
      and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
          pg_catalog.lower(pg_catalog.btrim(profile.email))
      and not exists (
        select 1
        from ceit_connect_private.user_email_preferences as preference
        where preference.user_id = queue.user_id
          and preference.important_updates_enabled is false
      )
    order by queue.priority, queue.created_at, queue.id
    limit v_claim_limit
    for update of queue skip locked
  ),
  leased as (
    update ceit_connect_private.email_delivery_queue as queue
    set state = 'leased', attempt_count = queue.attempt_count + 1,
        lease_token = candidate.lease_token,
        lease_expires_at = v_now + interval '2 minutes',
        run_id = v_run_id, updated_at = v_now
    from candidates as candidate
    where queue.id = candidate.id
    returning queue.id, queue.task_id, queue.notification_type,
      queue.priority, queue.created_at, queue.attempt_count, queue.lease_token,
      queue.lease_expires_at
  ),
  reserved as (
    insert into ceit_connect_private.email_send_attempts (
      delivery_id, attempt_number, reserved_at
    )
    select leased.id, leased.attempt_count, v_now from leased
    returning delivery_id
  )
  select
    leased.id as out_delivery_id,
    leased.lease_token as out_lease_token,
    v_run_id as out_run_id,
    v_run_token as out_run_token,
    leased.notification_type::text as out_notification_type,
    leased.attempt_count as out_attempt,
    leased.lease_expires_at as out_lease_expires_at
  from leased
  join reserved on reserved.delivery_id = leased.id
  order by leased.priority, leased.created_at, leased.id;

  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    delete from ceit_connect_private.email_delivery_runs where id = v_run_id;
  else
    update ceit_connect_private.email_delivery_runs
    set claimed_count = v_claimed where id = v_run_id;
  end if;
end;
$$;

alter function public.claim_email_deliveries(integer) owner to postgres;
revoke all on function public.claim_email_deliveries(integer)
from public, authenticated, service_role;
grant execute on function public.claim_email_deliveries(integer) to anon;

create or replace function ceit_connect_private.request_email_kick_if_due()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_allowance integer;
  v_used integer;
  v_manila_used integer;
  v_rolling_used integer;
  v_url_name text;
  v_wake_name text;
  v_url text;
  v_wake_secret text;
  v_request_id bigint;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;

  -- Cleanup remains live even while the sender is idle. This performs no
  -- Vault read and no HTTP request.
  perform ceit_connect_private.purge_email_delivery_history(v_now);

  -- The one-minute cron performs no Vault read and no HTTP request when no
  -- pending delivery or expired lease is due.
  if not exists (
    select 1
    from ceit_connect_private.email_delivery_queue as queue
    where (
      queue.state = 'pending'
      and queue.next_attempt_at <= v_now
      and queue.stale_at > v_now
      and queue.attempt_count < 5
    ) or (
      queue.state = 'leased' and queue.lease_expires_at <= v_now
    )
  ) then
    return false;
  end if;

  select config.daily_allowance
  into v_allowance
  from ceit_connect_private.email_delivery_config as config
  where config.singleton;

  select pg_catalog.count(*)::integer
  into v_manila_used
  from ceit_connect_private.email_send_attempts as attempt
  where (attempt.reserved_at at time zone 'Asia/Manila')::date =
        (v_now at time zone 'Asia/Manila')::date;
  select pg_catalog.count(*)::integer
  into v_rolling_used
  from ceit_connect_private.email_send_attempts as attempt
  where attempt.reserved_at > v_now - interval '24 hours';
  v_used := v_manila_used;
  if v_rolling_used > v_used then
    v_used := v_rolling_used;
  end if;

  -- A spent Manila-day allowance is also a no-wake condition: do not read
  -- Vault and do not create an HTTP request that cannot claim any delivery.
  if v_used >= v_allowance then
    return false;
  end if;

  begin
    select config.kick_url_secret_name, config.wake_secret_name
    into v_url_name, v_wake_name
    from ceit_connect_private.email_delivery_config as config
    where config.singleton;

    select secret.decrypted_secret into v_url
    from vault.decrypted_secrets as secret where secret.name = v_url_name;
    select secret.decrypted_secret into v_wake_secret
    from vault.decrypted_secrets as secret where secret.name = v_wake_name;
    if coalesce(v_url, '') = '' or coalesce(v_wake_secret, '') = '' then
      return false;
    end if;

    select net.http_post(
      url := v_url,
      headers := pg_catalog.jsonb_build_object(
        'content-type', 'application/json',
        'x-ceit-email-wake-secret', v_wake_secret
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    ) into v_request_id;

    update ceit_connect_private.email_kick_state
    set last_requested_at = v_now,
        request_count = request_count + 1,
        last_request_id = v_request_id
    where singleton;
    return true;
  exception when others then
    begin
      update ceit_connect_private.email_kick_state
      set last_error_at = pg_catalog.clock_timestamp(),
          error_count = error_count + 1
      where singleton;
    exception when others then
      null;
    end;
    return false;
  end;
end;
$$;

alter function ceit_connect_private.request_email_kick_if_due() owner to postgres;
revoke all on function ceit_connect_private.request_email_kick_if_due()
from public, anon, authenticated, service_role;

do $$
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

  if exists (
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
      and constraint_row.confrelid in (
        'public.events'::regclass,
        'public.tasks'::regclass
      )
    except
    select
      lock_row.constraint_name,
      lock_row.referencing_schema,
      lock_row.referencing_table,
      lock_row.referenced_table
    from ceit_connect_private.event_delete_fk_lock_list as lock_row
  ) or exists (
    select
      lock_row.constraint_name,
      lock_row.referencing_schema,
      lock_row.referencing_table,
      lock_row.referenced_table
    from ceit_connect_private.event_delete_fk_lock_list as lock_row
    except
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
      and constraint_row.confrelid in (
        'public.events'::regclass,
        'public.tasks'::regclass
      )
  ) then
    raise exception 'Event deletion foreign-key inventory identity mismatch.';
  end if;
end;
$$;

-- Phase 5 important email notifications: preference, outbox, secure sender,
-- bounded quota/retry, and a no-work/no-wake Prod cron boundary.

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'Important email migration must run as postgres.';
  end if;
  if pg_catalog.to_regclass('public.notifications') is null
     or pg_catalog.to_regclass('public.users') is null
     or pg_catalog.to_regprocedure(
       'ceit_connect_private.constant_time_equal_32(bytea,bytea)'
     ) is null then
    raise exception 'Important email prerequisites are unavailable.';
  end if;
end;
$$;

create table ceit_connect_private.user_email_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  important_updates_enabled boolean not null default true,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table ceit_connect_private.user_email_preferences owner to postgres;
alter table ceit_connect_private.user_email_preferences enable row level security;
revoke all on table ceit_connect_private.user_email_preferences
from public, anon, authenticated, service_role;

insert into ceit_connect_private.user_email_preferences (user_id)
select profile.id
from public.users as profile
on conflict (user_id) do nothing;

create function ceit_connect_private.seed_user_email_preference()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  -- AFTER INSERT only: never takes the officer advisory lock or a users-row
  -- lock, and never changes the established officer lock order.
  begin
    insert into ceit_connect_private.user_email_preferences (user_id)
    values (new.id)
    on conflict (user_id) do nothing;
  exception when others then
    null;
  end;
  return new;
end;
$$;

alter function ceit_connect_private.seed_user_email_preference() owner to postgres;
revoke all on function ceit_connect_private.seed_user_email_preference()
from public, anon, authenticated, service_role;

create trigger users_z9_seed_email_preference
after insert on public.users
for each row execute function ceit_connect_private.seed_user_email_preference();

create table ceit_connect_private.email_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid unique
    references public.notifications(id) on delete set null,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  notification_type text not null check (
    notification_type in ('assignment', 'task_due_soon', 'live_operation_prep')
  ),
  priority smallint not null check (priority in (0, 1)),
  state text not null default 'pending' check (
    state in ('pending', 'leased', 'delivered', 'terminal', 'suppressed', 'stale')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  stale_at timestamptz not null,
  lease_token uuid,
  lease_expires_at timestamptz,
  send_guard_until timestamptz,
  run_id uuid,
  delivered_at timestamptz,
  terminal_at timestamptz,
  terminal_reason text check (
    terminal_reason in (
      'permanent_failure', 'attempts_exhausted', 'preference_disabled',
      'recipient_ineligible', 'stale'
    )
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check (
    (state = 'leased' and lease_token is not null and lease_expires_at is not null)
    or (state <> 'leased' and lease_token is null and lease_expires_at is null)
  ),
  check (state = 'leased' or send_guard_until is null)
);

alter table ceit_connect_private.email_delivery_queue owner to postgres;
alter table ceit_connect_private.email_delivery_queue enable row level security;
revoke all on table ceit_connect_private.email_delivery_queue
from public, anon, authenticated, service_role;

create index email_delivery_queue_due_idx
on ceit_connect_private.email_delivery_queue (
  state, priority, next_attempt_at, created_at, id
);

create index email_delivery_queue_user_open_idx
on ceit_connect_private.email_delivery_queue (user_id, state, id)
where state in ('pending', 'leased');

create function ceit_connect_private.guard_task_email_send_content()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.title is not distinct from old.title
       and new.committee_id is not distinct from old.committee_id
       and new.primary_assignees is not distinct from old.primary_assignees
       and new.assist_assignees is not distinct from old.assist_assignees
       and new.is_confidential is not distinct from old.is_confidential
       and new.allowed_viewers is not distinct from old.allowed_viewers then
      return new;
    end if;
  end if;

  if exists (
    select 1
    from ceit_connect_private.email_delivery_queue as queue
    where queue.task_id = old.id
      and queue.state = 'leased'
      and queue.send_guard_until > pg_catalog.clock_timestamp()
  ) then
    raise exception using
      errcode = '55000',
      message = 'Task content is temporarily being prepared for email. Try again.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

alter function ceit_connect_private.guard_task_email_send_content() owner to postgres;
revoke all on function ceit_connect_private.guard_task_email_send_content()
from public, anon, authenticated, service_role;

create trigger tasks_y9_guard_email_send_content
before update or delete on public.tasks
for each row execute function ceit_connect_private.guard_task_email_send_content();

create table ceit_connect_private.email_send_attempts (
  -- Intentionally not a foreign key: this quota ledger must survive queue-row
  -- cleanup or notification deletion for the complete accounting window.
  delivery_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 5),
  reserved_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (delivery_id, attempt_number)
);

alter table ceit_connect_private.email_send_attempts owner to postgres;
alter table ceit_connect_private.email_send_attempts enable row level security;
revoke all on table ceit_connect_private.email_send_attempts
from public, anon, authenticated, service_role;

create index email_send_attempts_reserved_idx
on ceit_connect_private.email_send_attempts (reserved_at, delivery_id);

create table ceit_connect_private.email_delivery_runs (
  id uuid primary key default gen_random_uuid(),
  run_token uuid not null unique,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  finished_at timestamptz,
  status text not null default 'running' check (
    status in ('running', 'completed', 'completed_with_failures')
  ),
  claimed_count integer not null default 0 check (claimed_count between 0 and 10),
  delivered_count integer not null default 0 check (delivered_count between 0 and 10),
  retry_count integer not null default 0 check (retry_count between 0 and 10),
  terminal_count integer not null default 0 check (terminal_count between 0 and 10),
  unacknowledged_count integer not null default 0 check (
    unacknowledged_count between 0 and 10
  ),
  allowance_reached_count integer not null default 0 check (
    allowance_reached_count between 0 and 1
  )
);

alter table ceit_connect_private.email_delivery_runs owner to postgres;
alter table ceit_connect_private.email_delivery_runs enable row level security;
revoke all on table ceit_connect_private.email_delivery_runs
from public, anon, authenticated, service_role;

create table ceit_connect_private.email_sender_credentials (
  slot text primary key check (slot in ('current', 'next')),
  generation bigint not null unique check (generation > 0),
  salt bytea not null check (pg_catalog.octet_length(salt) = 32),
  secret_hash bytea not null check (pg_catalog.octet_length(secret_hash) = 32),
  installed_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table ceit_connect_private.email_sender_credentials owner to postgres;
alter table ceit_connect_private.email_sender_credentials enable row level security;
revoke all on table ceit_connect_private.email_sender_credentials
from public, anon, authenticated, service_role;

create table ceit_connect_private.email_delivery_config (
  singleton boolean primary key default true check (singleton),
  daily_allowance integer not null default 10 check (daily_allowance between 1 and 70),
  kick_url_secret_name text not null default 'email_kick_url',
  wake_secret_name text not null default 'email_wake_secret'
);

alter table ceit_connect_private.email_delivery_config owner to postgres;
alter table ceit_connect_private.email_delivery_config enable row level security;
revoke all on table ceit_connect_private.email_delivery_config
from public, anon, authenticated, service_role;
insert into ceit_connect_private.email_delivery_config (singleton) values (true);

create table ceit_connect_private.email_kick_state (
  singleton boolean primary key default true check (singleton),
  last_requested_at timestamptz,
  request_count bigint not null default 0 check (request_count >= 0),
  last_request_id bigint,
  last_error_at timestamptz,
  error_count bigint not null default 0 check (error_count >= 0)
);

alter table ceit_connect_private.email_kick_state owner to postgres;
alter table ceit_connect_private.email_kick_state enable row level security;
revoke all on table ceit_connect_private.email_kick_state
from public, anon, authenticated, service_role;
insert into ceit_connect_private.email_kick_state (singleton) values (true);

create function public.get_important_email_updates_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_enabled boolean;
begin
  if v_user_id is null or not exists (
    select 1 from public.users as profile
    where profile.id = v_user_id
      and profile.is_active is true
      and profile.anonymized_at is null
  ) then
    raise exception using errcode = '42501', message = 'Active account required.';
  end if;

  select preference.important_updates_enabled
  into v_enabled
  from ceit_connect_private.user_email_preferences as preference
  where preference.user_id = v_user_id;

  -- A missing seed row is deliberately equivalent to the default-on state.
  if not found then
    return true;
  end if;
  return v_enabled;
end;
$$;

alter function public.get_important_email_updates_enabled() owner to postgres;
revoke all on function public.get_important_email_updates_enabled()
from public, anon, authenticated, service_role;
grant execute on function public.get_important_email_updates_enabled()
to authenticated;

create function public.set_important_email_updates_enabled(p_enabled boolean)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null or not exists (
    select 1 from public.users as profile
    where profile.id = v_user_id
      and profile.is_active is true
      and profile.anonymized_at is null
  ) then
    raise exception using errcode = '42501', message = 'Active account required.';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'Email preference is required.';
  end if;

  insert into ceit_connect_private.user_email_preferences (
    user_id, important_updates_enabled, updated_at
  ) values (
    v_user_id, p_enabled, pg_catalog.clock_timestamp()
  )
  on conflict (user_id) do update
  set important_updates_enabled = excluded.important_updates_enabled,
      updated_at = excluded.updated_at;

  if p_enabled is false then
    update ceit_connect_private.email_delivery_queue as queue
    set state = 'suppressed',
        terminal_at = pg_catalog.clock_timestamp(),
        terminal_reason = 'preference_disabled',
        updated_at = pg_catalog.clock_timestamp()
    where queue.user_id = v_user_id
      and queue.state = 'pending';
  end if;
  return p_enabled;
end;
$$;

alter function public.set_important_email_updates_enabled(boolean) owner to postgres;
revoke all on function public.set_important_email_updates_enabled(boolean)
from public, anon, authenticated, service_role;
grant execute on function public.set_important_email_updates_enabled(boolean)
to authenticated;

create function ceit_connect_private.enqueue_important_email()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  begin
    if tg_op = 'INSERT'
       and new.type in ('assignment', 'task_due_soon', 'live_operation_prep')
       and exists (
         select 1
         from public.users as profile
         join auth.users as auth_user on auth_user.id = profile.id
         where profile.id = new.user_id
           and profile.is_active is true
           and profile.anonymized_at is null
           and auth_user.email_confirmed_at is not null
           and auth_user.email is not null
           and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
               pg_catalog.lower(pg_catalog.btrim(profile.email))
           and not exists (
             select 1
             from ceit_connect_private.user_email_preferences as preference
             where preference.user_id = profile.id
               and preference.important_updates_enabled is false
           )
       ) then
      insert into ceit_connect_private.email_delivery_queue (
        notification_id, task_id, user_id, notification_type, priority, stale_at
      ) values (
        new.id,
        new.task_id,
        new.user_id,
        new.type,
        case when new.type = 'assignment' then 0 else 1 end,
        new.created_at + interval '24 hours'
      )
      on conflict (notification_id) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;

alter function ceit_connect_private.enqueue_important_email() owner to postgres;
revoke all on function ceit_connect_private.enqueue_important_email()
from public, anon, authenticated, service_role;

create trigger notifications_z8_enqueue_important_email
after insert on public.notifications
for each row execute function ceit_connect_private.enqueue_important_email();

create function public.configure_email_daily_allowance(p_daily_allowance integer)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  if p_daily_allowance is null or p_daily_allowance not between 1 and 70 then
    raise exception using errcode = '22023', message = 'Daily allowance must be between 1 and 70.';
  end if;
  update ceit_connect_private.email_delivery_config
  set daily_allowance = p_daily_allowance
  where singleton;
  return p_daily_allowance;
end;
$$;

alter function public.configure_email_daily_allowance(integer) owner to postgres;
revoke all on function public.configure_email_daily_allowance(integer)
from public, anon, authenticated, service_role;

create function public.configure_email_sender_credential_hash(
  p_slot text,
  p_generation bigint,
  p_salt_hex text,
  p_hash_hex text
)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_salt bytea;
  v_hash bytea;
  v_highest bigint;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  if p_slot not in ('current', 'next') or p_generation is null or p_generation < 1
     or p_salt_hex !~ '^[0-9a-fA-F]{64}$'
     or p_hash_hex !~ '^[0-9a-fA-F]{64}$' then
    raise exception using errcode = '22023', message = 'Credential configuration is invalid.';
  end if;
  select pg_catalog.max(credential.generation)
  into v_highest
  from ceit_connect_private.email_sender_credentials as credential;
  if v_highest is not null and p_generation <= v_highest then
    raise exception using errcode = '22023', message = 'Credential generation must increase.';
  end if;
  v_salt := pg_catalog.decode(p_salt_hex, 'hex');
  v_hash := pg_catalog.decode(p_hash_hex, 'hex');
  insert into ceit_connect_private.email_sender_credentials (
    slot, generation, salt, secret_hash, installed_at
  ) values (
    p_slot, p_generation, v_salt, v_hash, pg_catalog.clock_timestamp()
  )
  on conflict (slot) do update
  set generation = excluded.generation,
      salt = excluded.salt,
      secret_hash = excluded.secret_hash,
      installed_at = excluded.installed_at;
  return p_generation;
end;
$$;

alter function public.configure_email_sender_credential_hash(text,bigint,text,text)
owner to postgres;
revoke all on function public.configure_email_sender_credential_hash(text,bigint,text,text)
from public, anon, authenticated, service_role;

create function public.retire_email_sender_credential(p_slot text)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  delete from ceit_connect_private.email_sender_credentials
  where slot = p_slot and p_slot in ('current', 'next');
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

alter function public.retire_email_sender_credential(text) owner to postgres;
revoke all on function public.retire_email_sender_credential(text)
from public, anon, authenticated, service_role;

create function ceit_connect_private.authenticate_email_sender()
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := '{}'::jsonb;
  v_secret text := '';
  v_current_salt bytea := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  v_current_hash bytea := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  v_current_generation bigint;
  v_next_salt bytea := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  v_next_hash bytea := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  v_next_generation bigint;
  v_current_candidate bytea;
  v_next_candidate bytea;
begin
  begin
    v_headers := coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  v_secret := pg_catalog.left(coalesce(v_headers ->> 'x-ceit-email-capability', ''), 256);

  select credential.salt, credential.secret_hash, credential.generation
  into v_current_salt, v_current_hash, v_current_generation
  from ceit_connect_private.email_sender_credentials as credential
  where credential.slot = 'current';
  if not found then
    v_current_salt := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
    v_current_hash := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  end if;

  select credential.salt, credential.secret_hash, credential.generation
  into v_next_salt, v_next_hash, v_next_generation
  from ceit_connect_private.email_sender_credentials as credential
  where credential.slot = 'next';
  if not found then
    v_next_salt := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
    v_next_hash := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  end if;

  v_current_candidate := extensions.digest(
    v_current_salt || pg_catalog.convert_to(v_secret, 'UTF8'), 'sha256'
  );
  v_next_candidate := extensions.digest(
    v_next_salt || pg_catalog.convert_to(v_secret, 'UTF8'), 'sha256'
  );
  if ceit_connect_private.constant_time_equal_32(v_current_candidate, v_current_hash)
     and v_current_generation is not null then
    return v_current_generation;
  end if;
  if ceit_connect_private.constant_time_equal_32(v_next_candidate, v_next_hash)
     and v_next_generation is not null then
    return v_next_generation;
  end if;
  return null;
end;
$$;

alter function ceit_connect_private.authenticate_email_sender() owner to postgres;
revoke all on function ceit_connect_private.authenticate_email_sender()
from public, anon, authenticated, service_role;

create function public.email_sender_ready()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if ceit_connect_private.authenticate_email_sender() is null then
    raise exception using errcode = '42501', message = 'Email sender authentication failed.';
  end if;
  return true;
end;
$$;

alter function public.email_sender_ready() owner to postgres;
revoke all on function public.email_sender_ready()
from public, authenticated, service_role;
grant execute on function public.email_sender_ready() to anon;

create function public.claim_email_deliveries(p_limit integer default 10)
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
  where queue.state in ('pending', 'leased') and queue.stale_at <= v_now;

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

create function public.prepare_email_delivery(
  p_delivery_id uuid,
  p_lease_token uuid
)
returns table (
  out_recipient_email text,
  out_notification_type text,
  out_task_title text,
  out_target_path text,
  out_is_confidential boolean,
  out_send_guard_expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_task_id uuid;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Email sender authentication failed.';
  end if;
  if p_delivery_id is null or p_lease_token is null then
    raise exception using errcode = '22023', message = 'Email delivery preparation is invalid.';
  end if;

  select queue.task_id
  into v_task_id
  from ceit_connect_private.email_delivery_queue as queue
  where queue.id = p_delivery_id
    and queue.state = 'leased'
    and queue.lease_token = p_lease_token
    and queue.lease_expires_at > v_now;
  if not found then
    return;
  end if;

  -- A task UPDATE/DELETE already owns this row before its email-content guard
  -- runs. Taking the conflicting SHARE lock first gives preparation the same
  -- task-before-queue order, then the next statement rereads current content.
  perform 1
  from public.tasks as task_row
  where task_row.id = v_task_id
  for share;
  if not found then
    return;
  end if;
  v_now := pg_catalog.clock_timestamp();

  -- Content is resolved at send preparation, not claim time. This is the
  -- confidentiality boundary immediately before the app calls Resend.
  return query
  with guarded as (
    update ceit_connect_private.email_delivery_queue as queue
    set send_guard_until = v_now + interval '30 seconds',
        lease_expires_at = case
          when queue.lease_expires_at < v_now + interval '30 seconds'
          then v_now + interval '30 seconds'
          else queue.lease_expires_at
        end,
        updated_at = v_now
    where queue.id = p_delivery_id
      and queue.state = 'leased'
      and queue.lease_token = p_lease_token
      and queue.lease_expires_at > v_now
    returning queue.id, queue.task_id, queue.user_id,
      queue.notification_type, queue.send_guard_until
  )
  select
    auth_user.email::text as out_recipient_email,
    guarded.notification_type::text as out_notification_type,
    case
      when task_row.is_confidential
        or public.task_content_access_for_user(task_row.id, guarded.user_id) <> 'real'
      then null else task_row.title
    end::text as out_task_title,
    case
      when task_row.is_confidential
        or public.task_content_access_for_user(task_row.id, guarded.user_id) <> 'real'
      then '/workspace'
      else pg_catalog.format('/tasks/%s', task_row.id)
    end::text as out_target_path,
    (
      task_row.is_confidential
      or public.task_content_access_for_user(task_row.id, guarded.user_id) <> 'real'
    ) as out_is_confidential,
    guarded.send_guard_until as out_send_guard_expires_at
  from guarded
  join public.tasks as task_row on task_row.id = guarded.task_id
  join public.users as profile on profile.id = guarded.user_id
  join auth.users as auth_user on auth_user.id = profile.id
  where profile.is_active is true
    and profile.anonymized_at is null
    and auth_user.email_confirmed_at is not null
    and auth_user.email is not null
    and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) =
        pg_catalog.lower(pg_catalog.btrim(profile.email))
    and not exists (
      select 1
      from ceit_connect_private.user_email_preferences as preference
      where preference.user_id = guarded.user_id
        and preference.important_updates_enabled is false
    );
end;
$$;

alter function public.prepare_email_delivery(uuid,uuid) owner to postgres;
revoke all on function public.prepare_email_delivery(uuid,uuid)
from public, authenticated, service_role;
grant execute on function public.prepare_email_delivery(uuid,uuid) to anon;

create function public.acknowledge_email_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_http_status integer default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_queue ceit_connect_private.email_delivery_queue%rowtype;
  v_delay interval;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Email sender authentication failed.';
  end if;
  if p_delivery_id is null or p_lease_token is null or p_outcome is null
     or p_outcome not in ('success', 'transient', 'permanent')
     or (p_http_status is not null and p_http_status not between 100 and 599) then
    raise exception using errcode = '22023', message = 'Email acknowledgement is invalid.';
  end if;

  select queue.* into v_queue
  from ceit_connect_private.email_delivery_queue as queue
  where queue.id = p_delivery_id
    and queue.state = 'leased'
    and queue.lease_token = p_lease_token
  for update;
  if not found then
    return false;
  end if;

  if p_outcome = 'success' then
    update ceit_connect_private.email_delivery_queue
    set state = 'delivered', delivered_at = v_now, lease_token = null,
        lease_expires_at = null, send_guard_until = null, updated_at = v_now
    where id = p_delivery_id;
  elsif p_outcome = 'permanent' then
    update ceit_connect_private.email_delivery_queue
    set state = 'terminal', terminal_at = v_now,
        terminal_reason = 'permanent_failure', lease_token = null,
        lease_expires_at = null, send_guard_until = null, updated_at = v_now
    where id = p_delivery_id;
  elsif v_queue.attempt_count >= 5 or v_queue.stale_at <= v_now then
    update ceit_connect_private.email_delivery_queue
    set state = case when v_queue.stale_at <= v_now then 'stale' else 'terminal' end,
        terminal_at = v_now,
        terminal_reason = case when v_queue.stale_at <= v_now then 'stale'
          else 'attempts_exhausted' end,
        lease_token = null, lease_expires_at = null, send_guard_until = null,
        updated_at = v_now
    where id = p_delivery_id;
  else
    v_delay := case v_queue.attempt_count
      when 1 then interval '5 minutes'
      when 2 then interval '15 minutes'
      when 3 then interval '1 hour'
      else interval '4 hours'
    end;
    update ceit_connect_private.email_delivery_queue
    set state = 'pending', next_attempt_at = v_now + v_delay,
        lease_token = null, lease_expires_at = null, send_guard_until = null,
        updated_at = v_now
    where id = p_delivery_id;
  end if;
  return true;
end;
$$;

alter function public.acknowledge_email_delivery(uuid,uuid,text,integer) owner to postgres;
revoke all on function public.acknowledge_email_delivery(uuid,uuid,text,integer)
from public, authenticated, service_role;
grant execute on function public.acknowledge_email_delivery(uuid,uuid,text,integer)
to anon;

create function public.finish_email_delivery_run(p_run_id uuid, p_run_token uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_generation bigint;
  v_updated integer;
begin
  v_generation := ceit_connect_private.authenticate_email_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Email sender authentication failed.';
  end if;
  if p_run_id is null or p_run_token is null then
    raise exception using errcode = '22023', message = 'Email run is invalid.';
  end if;

  update ceit_connect_private.email_delivery_runs as run_row
  set finished_at = pg_catalog.clock_timestamp(),
      delivered_count = outcome.delivered_count,
      retry_count = outcome.retry_count,
      terminal_count = outcome.terminal_count,
      unacknowledged_count = outcome.unacknowledged_count,
      status = case when outcome.unacknowledged_count > 0
        then 'completed_with_failures' else 'completed' end
  from (
    select
      pg_catalog.count(*) filter (where queue.state = 'delivered')::integer
        as delivered_count,
      pg_catalog.count(*) filter (where queue.state = 'pending')::integer
        as retry_count,
      pg_catalog.count(*) filter (
        where queue.state in ('terminal', 'stale', 'suppressed')
      )::integer as terminal_count,
      pg_catalog.count(*) filter (where queue.state = 'leased')::integer
        as unacknowledged_count
    from ceit_connect_private.email_delivery_queue as queue
    where queue.run_id = p_run_id
  ) as outcome
  where run_row.id = p_run_id
    and run_row.run_token = p_run_token
    and run_row.status = 'running';
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

alter function public.finish_email_delivery_run(uuid,uuid) owner to postgres;
revoke all on function public.finish_email_delivery_run(uuid,uuid)
from public, authenticated, service_role;
grant execute on function public.finish_email_delivery_run(uuid,uuid) to anon;

create function ceit_connect_private.purge_email_delivery_history(p_as_of timestamptz)
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

create function ceit_connect_private.request_email_kick_if_due()
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
$$;

alter function ceit_connect_private.request_email_kick_if_due() owner to postgres;
revoke all on function ceit_connect_private.request_email_kick_if_due()
from public, anon, authenticated, service_role;

comment on function ceit_connect_private.request_email_kick_if_due() is
  'Prod cron wake: performs bounded history cleanup, then returns false without Vault or HTTP work when no email delivery is due or the Manila-day or rolling-24-hour allowance is exhausted.';
comment on table ceit_connect_private.email_delivery_queue is
  'Content-free email outbox. Recipient addresses and task titles are resolved only by a capability-authenticated send preparation and are never stored here.';

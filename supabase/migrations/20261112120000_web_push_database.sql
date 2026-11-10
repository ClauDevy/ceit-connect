-- Phase 5 P1a: web-push database queue, private subscriptions, capability-
-- authenticated claim/acknowledge functions, coalesced wake requests, and
-- counts-only operational history. No service-role access is introduced.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

do $$
begin
  if current_user <> 'postgres' then
    raise exception 'P1a must be applied by postgres; current_user is %.', current_user;
  end if;
end
$$;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  endpoint_hash bytea not null,
  p256dh text not null,
  auth_secret text not null,
  device_label text not null,
  platform text not null check (platform in ('ios', 'android', 'desktop', 'unknown')),
  expires_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  last_seen_at timestamptz not null default pg_catalog.now(),
  constraint push_subscriptions_endpoint_hash_unique unique (endpoint_hash),
  constraint push_subscriptions_endpoint_length check (
    pg_catalog.length(endpoint) between 1 and 4096
  ),
  constraint push_subscriptions_p256dh_length check (
    pg_catalog.length(p256dh) between 80 and 100
    and p256dh ~ '^[A-Za-z0-9_-]+$'
  ),
  constraint push_subscriptions_auth_length check (
    pg_catalog.length(auth_secret) between 16 and 32
    and auth_secret ~ '^[A-Za-z0-9_-]+$'
  ),
  constraint push_subscriptions_device_label_length check (
    pg_catalog.length(device_label) between 1 and 80
  )
);

alter table public.push_subscriptions owner to postgres;
alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated, service_role;
grant select (id, device_label, platform, expires_at, created_at, updated_at, last_seen_at)
on public.push_subscriptions to authenticated;

create policy push_subscriptions_select_own
on public.push_subscriptions for select
to authenticated
using (
  user_id = auth.uid()
  and public.my_role() is not null
);

create index push_subscriptions_user_recent_idx
on public.push_subscriptions(user_id, last_seen_at desc, id);

create table ceit_connect_private.push_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null
    references public.notifications(id) on delete cascade,
  user_id uuid not null
    references public.users(id) on delete cascade,
  subscription_id uuid not null,
  notification_type text not null check (notification_type in (
    'mention', 'heads_up', 'assignment', 'status_change', 'unlock', 'backup_request'
  )),
  state text not null default 'pending'
    check (state in ('pending', 'leased', 'delivered', 'terminal')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz not null default pg_catalog.now(),
  retry_deadline_at timestamptz not null
    default (pg_catalog.now() + interval '1 hour'),
  lease_token uuid,
  lease_expires_at timestamptz,
  run_id uuid,
  delivered_at timestamptz,
  terminal_at timestamptz,
  terminal_reason text check (terminal_reason in (
    'permanent_failure', 'retry_window_exhausted', 'attempts_exhausted'
  )),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint push_delivery_queue_notification_subscription_unique
    unique (notification_id, subscription_id),
  constraint push_delivery_queue_lease_shape check (
    (state = 'leased' and lease_token is not null and lease_expires_at is not null and run_id is not null)
    or (state <> 'leased' and lease_token is null and lease_expires_at is null)
  ),
  constraint push_delivery_queue_terminal_shape check (
    (state = 'delivered' and delivered_at is not null and terminal_at is null and terminal_reason is null)
    or (state = 'terminal' and terminal_at is not null and terminal_reason is not null and delivered_at is null)
    or (state in ('pending', 'leased') and delivered_at is null and terminal_at is null and terminal_reason is null)
  )
);

alter table ceit_connect_private.push_delivery_queue owner to postgres;
alter table ceit_connect_private.push_delivery_queue enable row level security;
revoke all on table ceit_connect_private.push_delivery_queue
from public, anon, authenticated, service_role;

create index push_delivery_queue_claim_idx
on ceit_connect_private.push_delivery_queue(next_attempt_at, created_at, id)
where state = 'pending';

create index push_delivery_queue_lease_idx
on ceit_connect_private.push_delivery_queue(lease_expires_at, id)
where state = 'leased';

create index push_delivery_queue_retention_idx
on ceit_connect_private.push_delivery_queue(state, delivered_at, terminal_at, id)
where state in ('delivered', 'terminal');

create table ceit_connect_private.push_sender_credentials (
  slot text primary key check (slot in ('current', 'next')),
  generation bigint not null unique check (generation > 0),
  salt bytea not null check (pg_catalog.octet_length(salt) = 32),
  secret_hash bytea not null check (pg_catalog.octet_length(secret_hash) = 32),
  installed_at timestamptz not null default pg_catalog.now()
);

alter table ceit_connect_private.push_sender_credentials owner to postgres;
alter table ceit_connect_private.push_sender_credentials enable row level security;
revoke all on table ceit_connect_private.push_sender_credentials
from public, anon, authenticated, service_role;

create table ceit_connect_private.push_delivery_runs (
  id uuid primary key,
  run_token uuid not null unique,
  started_at timestamptz not null,
  finished_at timestamptz,
  claimed_count integer not null default 0 check (claimed_count between 0 and 100),
  delivered_count integer not null default 0 check (delivered_count >= 0),
  retry_scheduled_count integer not null default 0 check (retry_scheduled_count >= 0),
  terminal_count integer not null default 0 check (terminal_count >= 0),
  expired_subscription_count integer not null default 0 check (expired_subscription_count >= 0),
  unacknowledged_count integer not null default 0 check (unacknowledged_count >= 0)
);

alter table ceit_connect_private.push_delivery_runs owner to postgres;
alter table ceit_connect_private.push_delivery_runs enable row level security;
revoke all on table ceit_connect_private.push_delivery_runs
from public, anon, authenticated, service_role;

create index push_delivery_runs_retention_idx
on ceit_connect_private.push_delivery_runs(coalesce(finished_at, started_at), id);

create table ceit_connect_private.push_kick_state (
  singleton boolean primary key default true check (singleton),
  last_requested_at timestamptz,
  request_count bigint not null default 0 check (request_count >= 0),
  last_request_id bigint,
  last_error_at timestamptz,
  error_count bigint not null default 0 check (error_count >= 0)
);

insert into ceit_connect_private.push_kick_state(singleton)
values (true)
on conflict (singleton) do nothing;

alter table ceit_connect_private.push_kick_state owner to postgres;
alter table ceit_connect_private.push_kick_state enable row level security;
revoke all on table ceit_connect_private.push_kick_state
from public, anon, authenticated, service_role;

create table ceit_connect_private.push_environment_config (
  singleton boolean primary key default true check (singleton),
  kick_url_secret_name text not null default 'push_kick_url',
  wake_secret_name text not null default 'push_wake_secret',
  coalescing_seconds integer not null default 10 check (coalescing_seconds = 10)
);

insert into ceit_connect_private.push_environment_config(singleton)
values (true)
on conflict (singleton) do nothing;

alter table ceit_connect_private.push_environment_config owner to postgres;
alter table ceit_connect_private.push_environment_config enable row level security;
revoke all on table ceit_connect_private.push_environment_config
from public, anon, authenticated, service_role;

create function ceit_connect_private.constant_time_equal_32(
  p_left bytea,
  p_right bytea
)
returns boolean
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  v_difference integer := 0;
  v_index integer;
begin
  if pg_catalog.octet_length(p_left) <> 32
     or pg_catalog.octet_length(p_right) <> 32 then
    return false;
  end if;

  for v_index in 0..31 loop
    v_difference := v_difference |
      (pg_catalog.get_byte(p_left, v_index) # pg_catalog.get_byte(p_right, v_index));
  end loop;
  return v_difference = 0;
end;
$$;

alter function ceit_connect_private.constant_time_equal_32(bytea, bytea)
owner to postgres;
revoke all on function ceit_connect_private.constant_time_equal_32(bytea, bytea)
from public, anon, authenticated, service_role;

create function public.configure_push_sender_credential_hash(
  p_slot text,
  p_generation bigint,
  p_salt_hex text,
  p_secret_hash_hex text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_salt bytea;
  v_hash bytea;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  if p_slot not in ('current', 'next') or p_generation is null or p_generation <= 0 then
    raise exception using errcode = '22023', message = 'Credential metadata is invalid.';
  end if;
  begin
    v_salt := pg_catalog.decode(p_salt_hex, 'hex');
    v_hash := pg_catalog.decode(p_secret_hash_hex, 'hex');
  exception when others then
    raise exception using errcode = '22023', message = 'Credential material must be hexadecimal.';
  end;
  if pg_catalog.octet_length(v_salt) <> 32 or pg_catalog.octet_length(v_hash) <> 32 then
    raise exception using errcode = '22023', message = 'Credential material must be 32 bytes.';
  end if;

  insert into ceit_connect_private.push_sender_credentials(
    slot, generation, salt, secret_hash, installed_at
  ) values (
    p_slot, p_generation, v_salt, v_hash, pg_catalog.clock_timestamp()
  )
  on conflict (slot) do update
  set generation = excluded.generation,
      salt = excluded.salt,
      secret_hash = excluded.secret_hash,
      installed_at = excluded.installed_at;
end;
$$;

alter function public.configure_push_sender_credential_hash(text, bigint, text, text)
owner to postgres;
revoke all on function public.configure_push_sender_credential_hash(text, bigint, text, text)
from public, anon, authenticated, service_role;

create function public.retire_push_sender_credential(p_slot text)
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
  delete from ceit_connect_private.push_sender_credentials
  where slot = p_slot and p_slot in ('current', 'next');
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

alter function public.retire_push_sender_credential(text) owner to postgres;
revoke all on function public.retire_push_sender_credential(text)
from public, anon, authenticated, service_role;

create function ceit_connect_private.authenticate_push_sender()
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
  v_current_matches boolean;
  v_next_matches boolean;
begin
  begin
    v_headers := coalesce(
      nullif(pg_catalog.current_setting('request.headers', true), '')::jsonb,
      '{}'::jsonb
    );
  exception when others then
    v_headers := '{}'::jsonb;
  end;
  v_secret := pg_catalog.left(coalesce(v_headers ->> 'x-ceit-push-capability', ''), 256);

  select credential.salt, credential.secret_hash, credential.generation
  into v_current_salt, v_current_hash, v_current_generation
  from ceit_connect_private.push_sender_credentials as credential
  where credential.slot = 'current';
  if not found then
    v_current_salt := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
    v_current_hash := pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
  end if;

  select credential.salt, credential.secret_hash, credential.generation
  into v_next_salt, v_next_hash, v_next_generation
  from ceit_connect_private.push_sender_credentials as credential
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
  v_current_matches := ceit_connect_private.constant_time_equal_32(
    v_current_candidate, v_current_hash
  );
  v_next_matches := ceit_connect_private.constant_time_equal_32(
    v_next_candidate, v_next_hash
  );

  if v_current_matches and v_current_generation is not null then
    return v_current_generation;
  end if;
  if v_next_matches and v_next_generation is not null then
    return v_next_generation;
  end if;

  return null;
end;
$$;

alter function ceit_connect_private.authenticate_push_sender() owner to postgres;
revoke all on function ceit_connect_private.authenticate_push_sender()
from public, anon, authenticated, service_role;

create function ceit_connect_private.delete_push_subscription(p_subscription_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from ceit_connect_private.push_delivery_queue
  where subscription_id = p_subscription_id;
  delete from public.push_subscriptions
  where id = p_subscription_id;
  get diagnostics v_deleted = row_count;
  return v_deleted = 1;
end;
$$;

alter function ceit_connect_private.delete_push_subscription(uuid) owner to postgres;
revoke all on function ceit_connect_private.delete_push_subscription(uuid)
from public, anon, authenticated, service_role;

create function public.register_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth_secret text,
  p_device_label text,
  p_platform text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_endpoint text := pg_catalog.btrim(coalesce(p_endpoint, ''));
  v_host text;
  v_hash bytea;
  v_existing_id uuid;
  v_existing_user_id uuid;
  v_count integer;
begin
  if v_user_id is null or not exists (
    select 1 from public.users where id = v_user_id and is_active
  ) then
    raise exception using errcode = '42501', message = 'Active sign-in required.';
  end if;
  v_host := pg_catalog.lower(
    pg_catalog.substring(v_endpoint, '^https://([^/?#]+)')
  );
  if pg_catalog.length(v_endpoint) not between 1 and 4096
     or v_host is null
     or pg_catalog.strpos(v_endpoint, '#') > 0
     or pg_catalog.strpos(v_endpoint, '@') > 0
     or pg_catalog.strpos(v_host, ':') > 0
     or not (
       v_host in (
         'fcm.googleapis.com',
         'updates.push.services.mozilla.com',
         'web.push.apple.com'
       )
       or v_host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+notify\.windows\.com$'
     )
     or pg_catalog.length(coalesce(p_p256dh, '')) not between 80 and 100
     or coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]+$'
     or pg_catalog.length(coalesce(p_auth_secret, '')) not between 16 and 32
     or coalesce(p_auth_secret, '') !~ '^[A-Za-z0-9_-]+$'
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_device_label, ''))) not between 1 and 80
     or p_platform is null
     or p_platform not in ('ios', 'android', 'desktop', 'unknown')
     or (p_expires_at is not null and p_expires_at <= pg_catalog.clock_timestamp()) then
    raise exception using errcode = '22023', message = 'Push subscription is invalid.';
  end if;

  v_hash := extensions.digest(pg_catalog.convert_to(v_endpoint, 'UTF8'), 'sha256');
  -- Serialize every registration/removal-cap decision for this person, even
  -- when two different endpoints arrive concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ceit-connect:push-user:' || v_user_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.encode(v_hash, 'hex'), 0)
  );

  select subscription.id, subscription.user_id
  into v_existing_id, v_existing_user_id
  from public.push_subscriptions as subscription
  where subscription.endpoint_hash = v_hash
  for update;

  if v_existing_id is null then
    select pg_catalog.count(*)::integer into v_count
    from public.push_subscriptions
    where user_id = v_user_id;
    if v_count >= 5 then
      raise exception using errcode = 'P0001', message = 'PUSH_DEVICE_LIMIT';
    end if;
    insert into public.push_subscriptions(
      user_id, endpoint, endpoint_hash, p256dh, auth_secret,
      device_label, platform, expires_at
    ) values (
      v_user_id, v_endpoint, v_hash, p_p256dh, p_auth_secret,
      pg_catalog.btrim(p_device_label), p_platform, p_expires_at
    ) returning id into v_existing_id;
    return v_existing_id;
  end if;

  if v_existing_user_id is distinct from v_user_id then
    select pg_catalog.count(*)::integer into v_count
    from public.push_subscriptions
    where user_id = v_user_id;
    if v_count >= 5 then
      raise exception using errcode = 'P0001', message = 'PUSH_DEVICE_LIMIT';
    end if;
    delete from ceit_connect_private.push_delivery_queue
    where subscription_id = v_existing_id;
  end if;

  update public.push_subscriptions
  set user_id = v_user_id,
      endpoint = v_endpoint,
      p256dh = p_p256dh,
      auth_secret = p_auth_secret,
      device_label = pg_catalog.btrim(p_device_label),
      platform = p_platform,
      expires_at = p_expires_at,
      updated_at = pg_catalog.clock_timestamp(),
      last_seen_at = pg_catalog.clock_timestamp()
  where id = v_existing_id;
  return v_existing_id;
end;
$$;

alter function public.register_push_subscription(text, text, text, text, text, timestamptz)
owner to postgres;
revoke all on function public.register_push_subscription(text, text, text, text, text, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.register_push_subscription(text, text, text, text, text, timestamptz)
to authenticated;

create function public.list_my_push_subscriptions()
returns table (
  out_id uuid,
  out_device_label text,
  out_platform text,
  out_expires_at timestamptz,
  out_created_at timestamptz,
  out_last_seen_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select subscription.id, subscription.device_label, subscription.platform,
         subscription.expires_at, subscription.created_at, subscription.last_seen_at
  from public.push_subscriptions as subscription
  join public.users as profile on profile.id = subscription.user_id and profile.is_active
  where subscription.user_id = auth.uid()
  order by subscription.last_seen_at desc, subscription.id
$$;

alter function public.list_my_push_subscriptions() owner to postgres;
revoke all on function public.list_my_push_subscriptions()
from public, anon, authenticated, service_role;
grant execute on function public.list_my_push_subscriptions() to authenticated;

create function public.remove_my_push_subscription(p_subscription_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception using errcode = '42501', message = 'Active sign-in required.';
  end if;
  if not exists (
    select 1 from public.push_subscriptions
    where id = p_subscription_id and user_id = auth.uid()
  ) then
    return false;
  end if;
  return ceit_connect_private.delete_push_subscription(p_subscription_id);
end;
$$;

alter function public.remove_my_push_subscription(uuid) owner to postgres;
revoke all on function public.remove_my_push_subscription(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.remove_my_push_subscription(uuid) to authenticated;

create function public.remove_all_my_push_subscriptions()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subscription record;
  v_removed integer := 0;
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception using errcode = '42501', message = 'Active sign-in required.';
  end if;
  for v_subscription in
    select id from public.push_subscriptions where user_id = auth.uid() for update
  loop
    if ceit_connect_private.delete_push_subscription(v_subscription.id) then
      v_removed := v_removed + 1;
    end if;
  end loop;
  return v_removed;
end;
$$;

alter function public.remove_all_my_push_subscriptions() owner to postgres;
revoke all on function public.remove_all_my_push_subscriptions()
from public, anon, authenticated, service_role;
grant execute on function public.remove_all_my_push_subscriptions() to authenticated;

create function ceit_connect_private.request_push_kick(p_force boolean default false)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_last_requested_at timestamptz;
  v_window integer;
  v_url_name text;
  v_wake_name text;
  v_url text;
  v_wake_secret text;
  v_request_id bigint;
begin
  select config.coalescing_seconds, config.kick_url_secret_name, config.wake_secret_name
  into v_window, v_url_name, v_wake_name
  from ceit_connect_private.push_environment_config as config
  where config.singleton;

  select kick.last_requested_at
  into v_last_requested_at
  from ceit_connect_private.push_kick_state as kick
  where kick.singleton
  for update skip locked;

  if not found then
    return false;
  end if;

  if not coalesce(p_force, false)
     and v_last_requested_at is not null
     and v_last_requested_at > v_now - pg_catalog.make_interval(secs => v_window) then
    return false;
  end if;

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
      'x-ceit-wake-secret', v_wake_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  ) into v_request_id;

  update ceit_connect_private.push_kick_state
  set last_requested_at = v_now,
      request_count = request_count + 1,
      last_request_id = v_request_id
  where singleton;
  return true;
exception when others then
  begin
    update ceit_connect_private.push_kick_state
    set last_error_at = pg_catalog.clock_timestamp(),
        error_count = error_count + 1
    where singleton;
  exception when others then
    null;
  end;
  return false;
end;
$$;

alter function ceit_connect_private.request_push_kick(boolean) owner to postgres;
revoke all on function ceit_connect_private.request_push_kick(boolean)
from public, anon, authenticated, service_role;

create function ceit_connect_private.request_push_kick_if_due()
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if not exists (
    select 1
    from ceit_connect_private.push_delivery_queue as queue
    where (
      queue.state = 'pending'
      and queue.next_attempt_at <= v_now
      and queue.retry_deadline_at > v_now
      and queue.attempt_count < 8
    )
       or (queue.state = 'leased' and queue.lease_expires_at <= v_now)
  ) then
    return false;
  end if;

  return ceit_connect_private.request_push_kick(false);
end;
$$;

alter function ceit_connect_private.request_push_kick_if_due() owner to postgres;
revoke all on function ceit_connect_private.request_push_kick_if_due()
from public, anon, authenticated, service_role;

create function ceit_connect_private.enqueue_notification_push()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  begin
    insert into ceit_connect_private.push_delivery_queue(
      notification_id, user_id, subscription_id, notification_type
    )
    select new.id, new.user_id, subscription.id, new.type
    from public.push_subscriptions as subscription
    join public.users as profile
      on profile.id = subscription.user_id and profile.is_active
    where subscription.user_id = new.user_id
      and (subscription.expires_at is null or subscription.expires_at > pg_catalog.clock_timestamp())
    on conflict (notification_id, subscription_id) do nothing;
    get diagnostics v_inserted = row_count;
  exception when others then
    return new;
  end;

  if v_inserted > 0 then
    begin
      perform ceit_connect_private.request_push_kick(false);
    exception when others then
      null;
    end;
  end if;
  return new;
end;
$$;

alter function ceit_connect_private.enqueue_notification_push() owner to postgres;
revoke all on function ceit_connect_private.enqueue_notification_push()
from public, anon, authenticated, service_role;

create trigger notifications_z9_enqueue_push
after insert on public.notifications
for each row
execute function ceit_connect_private.enqueue_notification_push();

create function ceit_connect_private.remove_deactivated_push_subscriptions()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_subscription record;
begin
  if old.is_active and not new.is_active then
    for v_subscription in
      select id from public.push_subscriptions where user_id = new.id for update
    loop
      perform ceit_connect_private.delete_push_subscription(v_subscription.id);
    end loop;
  end if;
  return new;
end;
$$;

alter function ceit_connect_private.remove_deactivated_push_subscriptions()
owner to postgres;
revoke all on function ceit_connect_private.remove_deactivated_push_subscriptions()
from public, anon, authenticated, service_role;

create trigger users_z9_remove_deactivated_push_subscriptions
after update of is_active on public.users
for each row
when (old.is_active is true and new.is_active is false)
execute function ceit_connect_private.remove_deactivated_push_subscriptions();

create function public.claim_push_deliveries(p_limit integer default 50)
returns table (
  out_delivery_id uuid,
  out_lease_token uuid,
  out_run_id uuid,
  out_run_token uuid,
  out_endpoint text,
  out_p256dh text,
  out_auth_secret text,
  out_title text,
  out_body text,
  out_target_path text,
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
  v_run_id uuid := gen_random_uuid();
  v_run_token uuid := gen_random_uuid();
  v_claimed integer;
begin
  v_generation := ceit_connect_private.authenticate_push_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Push sender authentication failed.';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    raise exception using errcode = '22023', message = 'Claim limit must be between 1 and 100.';
  end if;

  delete from ceit_connect_private.push_delivery_queue as queue
  where not exists (
    select 1
    from public.notifications as notification
    join public.push_subscriptions as subscription
      on subscription.id = queue.subscription_id
     and subscription.user_id = queue.user_id
    join public.users as profile
      on profile.id = queue.user_id and profile.is_active
    where notification.id = queue.notification_id
  );

  update ceit_connect_private.push_delivery_queue
  set state = case
        when attempt_count >= 8 then 'terminal'
        when retry_deadline_at <= v_now then 'terminal'
        else 'pending'
      end,
      terminal_at = case
        when attempt_count >= 8 or retry_deadline_at <= v_now then v_now else null
      end,
      terminal_reason = case
        when attempt_count >= 8 then 'attempts_exhausted'
        when retry_deadline_at <= v_now then 'retry_window_exhausted'
        else null
      end,
      next_attempt_at = case
        when attempt_count < 8 and retry_deadline_at > v_now then v_now
        else next_attempt_at
      end,
      lease_token = null,
      lease_expires_at = null,
      updated_at = v_now
  where state = 'leased' and lease_expires_at <= v_now;

  insert into ceit_connect_private.push_delivery_runs(
    id, run_token, started_at
  ) values (
    v_run_id, v_run_token, v_now
  );

  return query
  with candidates as materialized (
    select queue.id
    from ceit_connect_private.push_delivery_queue as queue
    join public.notifications as notification
      on notification.id = queue.notification_id
    join public.push_subscriptions as subscription
      on subscription.id = queue.subscription_id
     and subscription.user_id = queue.user_id
    join public.users as profile
      on profile.id = queue.user_id and profile.is_active
    where queue.state = 'pending'
      and queue.next_attempt_at <= v_now
      and queue.retry_deadline_at > v_now
      and queue.attempt_count < 8
      and (subscription.expires_at is null or subscription.expires_at > v_now)
    order by queue.next_attempt_at, queue.created_at, queue.id
    limit p_limit
    for update of queue skip locked
  ), leased as (
    update ceit_connect_private.push_delivery_queue as queue
    set state = 'leased',
        attempt_count = queue.attempt_count + 1,
        lease_token = gen_random_uuid(),
        lease_expires_at = v_now + interval '2 minutes',
        run_id = v_run_id,
        updated_at = v_now
    from candidates
    where queue.id = candidates.id
    returning queue.*
  )
  select leased.id,
         leased.lease_token,
         v_run_id,
         v_run_token,
         subscription.endpoint,
         subscription.p256dh,
         subscription.auth_secret,
         'CEIT Connect'::text,
         case leased.notification_type
           when 'mention' then 'You were mentioned in a task.'
           when 'heads_up' then 'A task you’re assigned to has a new heads-up.'
           when 'assignment' then 'You were assigned to a task.'
           when 'status_change' then 'A task you’re assigned to changed status.'
           when 'unlock' then 'A task you’re assigned to is now unlocked.'
           when 'backup_request' then 'A task needs backup help.'
         end,
         '/notifications'::text,
         leased.notification_type,
         leased.attempt_count,
         leased.lease_expires_at
  from leased
  join public.push_subscriptions as subscription
    on subscription.id = leased.subscription_id;

  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    delete from ceit_connect_private.push_delivery_runs where id = v_run_id;
  else
    update ceit_connect_private.push_delivery_runs
    set claimed_count = v_claimed
    where id = v_run_id;
  end if;
end;
$$;

alter function public.claim_push_deliveries(integer) owner to postgres;
revoke all on function public.claim_push_deliveries(integer)
from public, anon, authenticated, service_role;
grant execute on function public.claim_push_deliveries(integer) to anon;

create function public.acknowledge_push_delivery(
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
  v_queue ceit_connect_private.push_delivery_queue%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_delay interval;
begin
  v_generation := ceit_connect_private.authenticate_push_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Push sender authentication failed.';
  end if;

  select * into v_queue
  from ceit_connect_private.push_delivery_queue
  where id = p_delivery_id
    and state = 'leased'
    and lease_token = p_lease_token
  for update;
  if not found then
    return false;
  end if;

  if p_outcome = 'success' and p_http_status between 200 and 299 then
    update ceit_connect_private.push_delivery_queue
    set state = 'delivered', delivered_at = v_now,
        lease_token = null, lease_expires_at = null, updated_at = v_now
    where id = p_delivery_id;
    update ceit_connect_private.push_delivery_runs
    set delivered_count = delivered_count + 1
    where id = v_queue.run_id;
    return true;
  end if;

  if p_outcome = 'gone' and p_http_status in (404, 410) then
    update ceit_connect_private.push_delivery_runs
    set expired_subscription_count = expired_subscription_count + 1
    where id = v_queue.run_id;
    perform ceit_connect_private.delete_push_subscription(v_queue.subscription_id);
    return true;
  end if;

  if p_outcome = 'transient'
     and (p_http_status is null or p_http_status in (408, 425, 429)
          or p_http_status between 500 and 599) then
    v_delay := case v_queue.attempt_count
      when 1 then interval '30 seconds'
      when 2 then interval '1 minute'
      when 3 then interval '2 minutes'
      when 4 then interval '5 minutes'
      when 5 then interval '10 minutes'
      when 6 then interval '15 minutes'
      else interval '20 minutes'
    end;
    if v_queue.attempt_count >= 8 then
      update ceit_connect_private.push_delivery_queue
      set state = 'terminal', terminal_at = v_now,
          terminal_reason = 'attempts_exhausted',
          lease_token = null, lease_expires_at = null, updated_at = v_now
      where id = p_delivery_id;
      update ceit_connect_private.push_delivery_runs
      set terminal_count = terminal_count + 1 where id = v_queue.run_id;
    elsif v_now + v_delay > v_queue.retry_deadline_at then
      update ceit_connect_private.push_delivery_queue
      set state = 'terminal', terminal_at = v_now,
          terminal_reason = 'retry_window_exhausted',
          lease_token = null, lease_expires_at = null, updated_at = v_now
      where id = p_delivery_id;
      update ceit_connect_private.push_delivery_runs
      set terminal_count = terminal_count + 1 where id = v_queue.run_id;
    else
      update ceit_connect_private.push_delivery_queue
      set state = 'pending', next_attempt_at = v_now + v_delay,
          lease_token = null, lease_expires_at = null, updated_at = v_now
      where id = p_delivery_id;
      update ceit_connect_private.push_delivery_runs
      set retry_scheduled_count = retry_scheduled_count + 1 where id = v_queue.run_id;
    end if;
    return true;
  end if;

  if p_outcome = 'permanent'
     and p_http_status between 400 and 499
     and p_http_status not in (404, 408, 410, 425, 429) then
    update ceit_connect_private.push_delivery_queue
    set state = 'terminal', terminal_at = v_now,
        terminal_reason = 'permanent_failure',
        lease_token = null, lease_expires_at = null, updated_at = v_now
    where id = p_delivery_id;
    update ceit_connect_private.push_delivery_runs
    set terminal_count = terminal_count + 1 where id = v_queue.run_id;
    return true;
  end if;

  raise exception using errcode = '22023', message = 'Delivery outcome is invalid.';
end;
$$;

alter function public.acknowledge_push_delivery(uuid, uuid, text, integer)
owner to postgres;
revoke all on function public.acknowledge_push_delivery(uuid, uuid, text, integer)
from public, anon, authenticated, service_role;
grant execute on function public.acknowledge_push_delivery(uuid, uuid, text, integer)
to anon;

create function public.finish_push_delivery_run(p_run_id uuid, p_run_token uuid)
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
  v_generation := ceit_connect_private.authenticate_push_sender();
  if v_generation is null then
    raise exception using errcode = '42501', message = 'Push sender authentication failed.';
  end if;
  update ceit_connect_private.push_delivery_runs
  set finished_at = coalesce(finished_at, pg_catalog.clock_timestamp()),
      unacknowledged_count = greatest(
        claimed_count - delivered_count - retry_scheduled_count
          - terminal_count - expired_subscription_count,
        0
      )
  where id = p_run_id and run_token = p_run_token;
  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

alter function public.finish_push_delivery_run(uuid, uuid) owner to postgres;
revoke all on function public.finish_push_delivery_run(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.finish_push_delivery_run(uuid, uuid) to anon;

create function public.run_push_delivery_cleanup()
returns table (
  out_expired_subscriptions integer,
  out_released_leases integer,
  out_expired_deliveries integer,
  out_deleted_deliveries integer,
  out_deleted_runs integer
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_subscription record;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'Postgres session required.';
  end if;
  out_expired_subscriptions := 0;
  out_released_leases := 0;
  out_expired_deliveries := 0;
  out_deleted_deliveries := 0;
  out_deleted_runs := 0;

  for v_subscription in
    select subscription.id
    from public.push_subscriptions as subscription
    left join public.users as profile on profile.id = subscription.user_id
    where (subscription.expires_at is not null and subscription.expires_at <= v_now)
       or profile.id is null or not profile.is_active
    for update of subscription skip locked
  loop
    if ceit_connect_private.delete_push_subscription(v_subscription.id) then
      out_expired_subscriptions := out_expired_subscriptions + 1;
    end if;
  end loop;

  update ceit_connect_private.push_delivery_queue
  set state = 'pending', next_attempt_at = v_now,
      lease_token = null, lease_expires_at = null, updated_at = v_now
  where state = 'leased' and lease_expires_at <= v_now
    and attempt_count < 8 and retry_deadline_at > v_now;
  get diagnostics out_released_leases = row_count;

  update ceit_connect_private.push_delivery_queue
  set state = 'terminal', terminal_at = v_now,
      terminal_reason = case when attempt_count >= 8
        then 'attempts_exhausted' else 'retry_window_exhausted' end,
      lease_token = null, lease_expires_at = null, updated_at = v_now
  where state in ('pending', 'leased')
    and (attempt_count >= 8 or retry_deadline_at <= v_now);
  get diagnostics out_expired_deliveries = row_count;

  delete from ceit_connect_private.push_delivery_queue
  where (state = 'delivered' and delivered_at < v_now - interval '3 days')
     or (state = 'terminal' and terminal_at < v_now - interval '7 days');
  get diagnostics out_deleted_deliveries = row_count;

  delete from ceit_connect_private.push_delivery_runs
  where coalesce(finished_at, started_at) < v_now - interval '30 days';
  get diagnostics out_deleted_runs = row_count;

  return next;
end;
$$;

alter function public.run_push_delivery_cleanup() owner to postgres;
revoke all on function public.run_push_delivery_cleanup()
from public, anon, authenticated, service_role;

comment on table public.push_subscriptions is
  'Private per-person web-push endpoints. Browser roles can list only safe columns for their own active profile; endpoint key material is exposed only by the capability-authenticated claim function.';
comment on table ceit_connect_private.push_delivery_queue is
  'Private delivery queue. Its only foreign keys are notification_id and user_id; deleting a notification cascades its pending or leased deliveries.';
comment on table ceit_connect_private.push_delivery_runs is
  'Counts-only push sender logbook retained for 30 days. It contains no user, notification, task, subscription, endpoint, or message fields.';
comment on function public.claim_push_deliveries(integer) is
  'Anon-key callable only with the separate sender capability header. Claims server-created queue rows for two minutes and returns fixed generic copy.';
comment on function public.acknowledge_push_delivery(uuid, uuid, text, integer) is
  'Capability-authenticated outcome writer. Missing or stale delivery IDs are quiet false results; 404/410 removes the subscription; only transient outcomes retry.';
comment on function ceit_connect_private.request_push_kick(boolean) is
  'Requests a constant-body sender wake using Vault-held per-environment URL and secret. Ordinary requests coalesce within exactly ten seconds, and a concurrent state-row lock returns false without waiting.';
comment on function ceit_connect_private.request_push_kick_if_due() is
  'Requests a coalesced wake only when a pending delivery is due now, still inside its retry window, and under eight attempts, or when a delivery lease has expired.';

-- Batch 14 Part 2: revoke every refreshable Auth session after an account is
-- deactivated. The route bans the Auth user first; this database boundary
-- removes the already-issued sessions without changing identities or profile
-- metadata, so ordinary deactivation remains reversible.

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'auth'
      and relation.relname = 'sessions'
      and relation.relkind in ('r', 'p')
      and attribute.attname = 'user_id'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_class as relation
      on relation.oid = attribute.attrelid
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'auth'
      and relation.relname = 'refresh_tokens'
      and relation.relkind in ('r', 'p')
      and attribute.attname = 'user_id'
      and attribute.attnum > 0
      and not attribute.attisdropped
  ) then
    raise exception using
      errcode = 'CIS00',
      message = 'Required Auth session catalog columns are unavailable.';
  end if;
end;
$$;

create function public.revoke_inactive_user_sessions(p_user_id uuid)
returns table (
  out_user_id uuid,
  out_outcome text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_is_active boolean;
  v_banned_until timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = 'CIS01',
      message = 'Inactive-user session cleanup requires service_role.';
  end if;

  select profile.is_active
  into v_is_active
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'CIS02',
      message = 'The inactive profile is unavailable.';
  end if;

  if v_is_active is distinct from false then
    raise exception using
      errcode = 'CIS03',
      message = 'Sessions can be revoked only for an inactive profile.';
  end if;

  select auth_user.banned_until
  into v_banned_until
  from auth.users as auth_user
  where auth_user.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'CIS04',
      message = 'The Auth user is unavailable.';
  end if;

  if v_banned_until is null
     or v_banned_until <= pg_catalog.clock_timestamp() then
    raise exception using
      errcode = 'CIS05',
      message = 'The inactive Auth user must be banned before session cleanup.';
  end if;

  delete from auth.sessions as session
  where session.user_id = p_user_id;

  delete from auth.refresh_tokens as token
  where token.user_id = p_user_id::text;

  if exists (
    select 1
    from auth.sessions as session
    where session.user_id = p_user_id
  ) or exists (
    select 1
    from auth.refresh_tokens as token
    where token.user_id = p_user_id::text
  ) then
    raise exception using
      errcode = 'CIS06',
      message = 'Inactive-user session cleanup was incomplete.';
  end if;

  out_user_id := p_user_id;
  out_outcome := 'revoked';
  return next;
end;
$$;

alter function public.revoke_inactive_user_sessions(uuid) owner to postgres;
revoke all on function public.revoke_inactive_user_sessions(uuid) from public;
revoke all on function public.revoke_inactive_user_sessions(uuid) from anon;
revoke all on function public.revoke_inactive_user_sessions(uuid) from authenticated;
revoke all on function public.revoke_inactive_user_sessions(uuid) from service_role;
grant execute on function public.revoke_inactive_user_sessions(uuid) to service_role;

comment on function public.revoke_inactive_user_sessions(uuid) is
  'Service-role-only reversible-deactivation cleanup. Requires an inactive profile and a banned Auth user, then removes existing Auth sessions and refresh tokens without changing identities or metadata.';

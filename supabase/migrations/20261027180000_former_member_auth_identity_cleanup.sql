-- Batch 10 Stage B Phase 1b: add the guarded, idempotent Auth identity,
-- personal-data, session, token, MFA, and OAuth-flow cleanup boundary for an
-- already-anonymized former member.

do $$
declare
  v_check record;
begin
  for v_check in
    select *
    from (values
      ('users', 'id'),
      ('users', 'email'),
      ('users', 'email_confirmed_at'),
      ('users', 'banned_until'),
      ('users', 'encrypted_password'),
      ('users', 'created_at'),
      ('users', 'updated_at'),
      ('users', 'last_sign_in_at'),
      ('users', 'invited_at'),
      ('users', 'raw_user_meta_data'),
      ('users', 'raw_app_meta_data'),
      ('users', 'phone'),
      ('users', 'phone_confirmed_at'),
      ('users', 'phone_change'),
      ('users', 'phone_change_token'),
      ('users', 'phone_change_sent_at'),
      ('users', 'email_change'),
      ('users', 'email_change_token_new'),
      ('users', 'email_change_token_current'),
      ('users', 'email_change_sent_at'),
      ('users', 'email_change_confirm_status'),
      ('users', 'confirmation_token'),
      ('users', 'confirmation_sent_at'),
      ('users', 'recovery_token'),
      ('users', 'recovery_sent_at'),
      ('users', 'reauthentication_token'),
      ('users', 'reauthentication_sent_at'),
      ('identities', 'id'),
      ('identities', 'user_id'),
      ('identities', 'provider'),
      ('identities', 'provider_id'),
      ('identities', 'identity_data'),
      ('sessions', 'user_id'),
      ('refresh_tokens', 'user_id')
    ) as required(table_name, column_name)
  loop
    if not exists (
      select 1
      from pg_catalog.pg_attribute as attribute
      join pg_catalog.pg_class as relation
        on relation.oid = attribute.attrelid
      join pg_catalog.pg_namespace as namespace
        on namespace.oid = relation.relnamespace
      where namespace.nspname = 'auth'
        and relation.relname = v_check.table_name
        and relation.relkind in ('r', 'p')
        and attribute.attname = v_check.column_name
        and attribute.attnum > 0
        and not attribute.attisdropped
    ) then
      raise exception using
        errcode = 'CMI00',
        message = pg_catalog.format(
          'Required auth catalog column is missing: auth.%I.%I',
          v_check.table_name,
          v_check.column_name
        );
    end if;
  end loop;
end;
$$;

create function public.cleanup_former_member_auth(p_user_id uuid)
returns table (
  out_user_id uuid,
  out_outcome text,
  out_email_identity_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.users%rowtype;
  v_auth auth.users%rowtype;
  v_email_identity_count integer;
  v_expected_email text := p_user_id::text || '@former.invalid';
  v_expected_identity_data jsonb := pg_catalog.jsonb_build_object(
    'sub', p_user_id::text,
    'email', p_user_id::text || '@former.invalid',
    'email_verified', true,
    'phone_verified', false
  );
  v_expected_app_metadata jsonb := pg_catalog.jsonb_build_object(
    'provider', 'email',
    'providers', pg_catalog.jsonb_build_array('email')
  );
  v_password_hash text;
  v_confirmed_at timestamptz;
  v_banned_until timestamptz;
  v_created_at timestamptz;
  v_updated_at timestamptz;
  v_last_sign_in_at timestamptz;
  v_invited_at timestamptz;
  v_remaining bigint;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception using
      errcode = 'CMI01',
      message = 'Former-member Auth cleanup requires service_role.';
  end if;

  select profile.*
  into v_profile
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'CMI02',
      message = 'Former-member profile is unavailable.';
  end if;

  if v_profile.is_active is distinct from false then
    raise exception using
      errcode = 'CMI03',
      message = 'Former-member profile must be inactive.';
  end if;

  if v_profile.anonymized_at is null then
    raise exception using
      errcode = 'CMI04',
      message = 'Former-member profile must already be anonymized.';
  end if;

  select auth_user.*
  into v_auth
  from auth.users as auth_user
  where auth_user.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'CMI05',
      message = 'Former-member Auth user is unavailable.';
  end if;

  if v_auth.email is distinct from v_expected_email then
    raise exception using
      errcode = 'CMI06',
      message = 'Former-member Auth email is not deterministic.';
  end if;

  if v_auth.email_confirmed_at is null then
    raise exception using
      errcode = 'CMI07',
      message = 'Former-member Auth email is not confirmed.';
  end if;

  if v_auth.banned_until is null
     or v_auth.banned_until <= pg_catalog.clock_timestamp() then
    raise exception using
      errcode = 'CMI08',
      message = 'Former-member Auth user is not banned.';
  end if;

  perform 1
  from auth.identities as identity
  where identity.user_id = p_user_id
  for update;

  select count(*)::integer
  into v_email_identity_count
  from auth.identities as identity
  where identity.user_id = p_user_id
    and identity.provider = 'email';

  if v_email_identity_count > 1 then
    raise exception using
      errcode = 'CMI09',
      message = 'Former-member Auth user has multiple email identities.';
  end if;

  if v_email_identity_count = 1 and exists (
    select 1
    from auth.identities as identity
    where identity.provider = 'email'
      and identity.provider_id = p_user_id::text
      and identity.user_id <> p_user_id
  ) then
    raise exception using
      errcode = 'CMI10',
      message = 'Former-member email identity provider id is already in use.';
  end if;

  v_password_hash := v_auth.encrypted_password;
  v_confirmed_at := v_auth.email_confirmed_at;
  v_banned_until := v_auth.banned_until;
  v_created_at := v_auth.created_at;
  v_updated_at := v_auth.updated_at;
  v_last_sign_in_at := v_auth.last_sign_in_at;
  v_invited_at := v_auth.invited_at;

  delete from auth.identities as identity
  where identity.user_id = p_user_id
    and identity.provider <> 'email';

  if v_email_identity_count = 1 then
    update auth.identities as identity
    set provider_id = p_user_id::text,
        identity_data = v_expected_identity_data
    where identity.user_id = p_user_id
      and identity.provider = 'email';
  end if;

  update auth.users as auth_user
  set raw_user_meta_data = '{}'::jsonb,
      raw_app_meta_data = v_expected_app_metadata,
      phone = null,
      phone_confirmed_at = null,
      phone_change = '',
      phone_change_token = '',
      phone_change_sent_at = null,
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      email_change_sent_at = null,
      email_change_confirm_status = 0,
      confirmation_token = '',
      confirmation_sent_at = null,
      recovery_token = '',
      recovery_sent_at = null,
      reauthentication_token = '',
      reauthentication_sent_at = null
  where auth_user.id = p_user_id;

  delete from auth.sessions as session
  where session.user_id = p_user_id;

  delete from auth.refresh_tokens as token
  where token.user_id = p_user_id::text;

  if pg_catalog.to_regclass('auth.mfa_factors') is not null
     and exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = pg_catalog.to_regclass('auth.mfa_factors')
         and attribute.attname = 'user_id'
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) then
    execute 'delete from auth.mfa_factors where user_id = $1'
    using p_user_id;
  end if;

  if pg_catalog.to_regclass('auth.one_time_tokens') is not null
     and exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = pg_catalog.to_regclass('auth.one_time_tokens')
         and attribute.attname = 'user_id'
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) then
    execute 'delete from auth.one_time_tokens where user_id = $1'
    using p_user_id;
  end if;

  if pg_catalog.to_regclass('auth.flow_state') is not null
     and exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = pg_catalog.to_regclass('auth.flow_state')
         and attribute.attname = 'user_id'
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) then
    execute 'delete from auth.flow_state where user_id = $1'
    using p_user_id;
  end if;

  select auth_user.*
  into v_auth
  from auth.users as auth_user
  where auth_user.id = p_user_id;

  if v_auth.id is distinct from p_user_id
     or v_auth.email is distinct from v_expected_email
     or v_auth.email_confirmed_at is distinct from v_confirmed_at
     or v_auth.banned_until is distinct from v_banned_until
     or v_auth.encrypted_password is distinct from v_password_hash
     or v_auth.created_at is distinct from v_created_at
     or v_auth.updated_at is distinct from v_updated_at
     or v_auth.last_sign_in_at is distinct from v_last_sign_in_at
     or v_auth.invited_at is distinct from v_invited_at then
    raise exception using
      errcode = 'CMI11',
      message = 'Protected former-member Auth fields changed unexpectedly.';
  end if;

  if v_auth.raw_user_meta_data is distinct from '{}'::jsonb
     or v_auth.raw_app_meta_data is distinct from v_expected_app_metadata
     or v_auth.phone is not null
     or coalesce(v_auth.phone_change, '') <> ''
     or v_auth.phone_confirmed_at is not null
     or v_auth.phone_change_sent_at is not null
     or coalesce(v_auth.phone_change_token, '') <> ''
     or coalesce(v_auth.email_change, '') <> ''
     or coalesce(v_auth.email_change_token_new, '') <> ''
     or coalesce(v_auth.email_change_token_current, '') <> ''
     or v_auth.email_change_sent_at is not null
     or v_auth.email_change_confirm_status is distinct from 0
     or coalesce(v_auth.confirmation_token, '') <> ''
     or v_auth.confirmation_sent_at is not null
     or coalesce(v_auth.recovery_token, '') <> ''
     or v_auth.recovery_sent_at is not null
     or coalesce(v_auth.reauthentication_token, '') <> ''
     or v_auth.reauthentication_sent_at is not null then
    raise exception using
      errcode = 'CMI12',
      message = 'Former-member Auth personal data cleanup was incomplete.';
  end if;

  select count(*)
  into v_remaining
  from auth.identities as identity
  where identity.user_id = p_user_id
    and identity.provider <> 'email';

  if v_remaining <> 0 then
    raise exception using
      errcode = 'CMI13',
      message = 'Former-member non-email identity cleanup was incomplete.';
  end if;

  if v_email_identity_count = 1 and not exists (
    select 1
    from auth.identities as identity
    where identity.user_id = p_user_id
      and identity.provider = 'email'
      and identity.provider_id = p_user_id::text
      and identity.identity_data = v_expected_identity_data
  ) then
    raise exception using
      errcode = 'CMI14',
      message = 'Former-member email identity cleanup was incomplete.';
  end if;

  select count(*)
  into v_remaining
  from auth.identities as identity
  where identity.user_id = p_user_id
    and identity.provider = 'email';

  if v_remaining <> v_email_identity_count then
    raise exception using
      errcode = 'CMI14',
      message = 'Former-member email identity count changed unexpectedly.';
  end if;

  if exists (
    select 1 from auth.sessions as session where session.user_id = p_user_id
  ) or exists (
    select 1
    from auth.refresh_tokens as token
    where token.user_id = p_user_id::text
  ) then
    raise exception using
      errcode = 'CMI15',
      message = 'Former-member session cleanup was incomplete.';
  end if;

  if pg_catalog.to_regclass('auth.mfa_factors') is not null
     and exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = pg_catalog.to_regclass('auth.mfa_factors')
         and attribute.attname = 'user_id'
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) then
    execute 'select count(*) from auth.mfa_factors where user_id = $1'
    into v_remaining
    using p_user_id;
    if v_remaining <> 0 then
      raise exception using errcode = 'CMI16', message = 'Former-member MFA cleanup was incomplete.';
    end if;
  end if;

  if pg_catalog.to_regclass('auth.one_time_tokens') is not null
     and exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = pg_catalog.to_regclass('auth.one_time_tokens')
         and attribute.attname = 'user_id'
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) then
    execute 'select count(*) from auth.one_time_tokens where user_id = $1'
    into v_remaining
    using p_user_id;
    if v_remaining <> 0 then
      raise exception using errcode = 'CMI17', message = 'Former-member one-time-token cleanup was incomplete.';
    end if;
  end if;

  if pg_catalog.to_regclass('auth.flow_state') is not null
     and exists (
       select 1
       from pg_catalog.pg_attribute as attribute
       where attribute.attrelid = pg_catalog.to_regclass('auth.flow_state')
         and attribute.attname = 'user_id'
         and attribute.attnum > 0
         and not attribute.attisdropped
     ) then
    execute 'select count(*) from auth.flow_state where user_id = $1'
    into v_remaining
    using p_user_id;
    if v_remaining <> 0 then
      raise exception using errcode = 'CMI18', message = 'Former-member flow-state cleanup was incomplete.';
    end if;
  end if;

  out_user_id := p_user_id;
  out_outcome := 'cleaned';
  out_email_identity_count := v_email_identity_count;
  return next;
end;
$$;

alter function public.cleanup_former_member_auth(uuid) owner to postgres;
revoke all on function public.cleanup_former_member_auth(uuid) from public;
revoke all on function public.cleanup_former_member_auth(uuid) from anon;
revoke all on function public.cleanup_former_member_auth(uuid) from authenticated;
grant execute on function public.cleanup_former_member_auth(uuid) to service_role;

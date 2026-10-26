-- Phase 4B Batch 8: narrow officer invitations and transitions.
-- Active officer profiles are seats. A preparing invitation temporarily
-- reserves one seat until it is finalized or released.

create table public.app_settings (
  key text primary key default 'global',
  enforce_officer_role_caps boolean not null default false,
  constraint app_settings_singleton_key check (key = 'global')
);

insert into public.app_settings (key, enforce_officer_role_caps)
values ('global', false);

alter table public.app_settings enable row level security;
revoke all on table public.app_settings from public, anon, authenticated;

create table public.officer_invites (
  id uuid primary key,
  email text not null,
  full_name text not null,
  officer_role text not null,
  committee_id uuid references public.committees(id),
  auth_user_id uuid,
  invited_by uuid not null references public.users(id),
  status text not null default 'preparing',
  failure_code text,
  created_at timestamptz not null default pg_catalog.now(),
  sent_at timestamptz,
  reservation_released_at timestamptz,
  cancelled_at timestamptz,
  auth_cleanup_completed_at timestamptz,
  constraint officer_invites_normalized_email
    check (email = pg_catalog.lower(pg_catalog.btrim(email)) and email <> ''),
  constraint officer_invites_full_name_length
    check (pg_catalog.char_length(full_name) between 1 and 100),
  constraint officer_invites_role
    check (officer_role in ('Admin', 'Co-Admin')),
  constraint officer_invites_role_committee
    check (
      (officer_role = 'Admin' and committee_id is null)
      or (officer_role = 'Co-Admin' and committee_id is not null)
    ),
  constraint officer_invites_status
    check (status in ('preparing', 'sent', 'cleanup_pending', 'cancelled')),
  constraint officer_invites_release_state
    check (
      (status = 'preparing' and reservation_released_at is null)
      or (status <> 'preparing' and reservation_released_at is not null)
    ),
  constraint officer_invites_sent_state
    check (
      (status = 'sent' and auth_user_id is not null and sent_at is not null)
      or status <> 'sent'
    ),
  constraint officer_invites_cancelled_state
    check (
      (status = 'cancelled' and cancelled_at is not null)
      or status <> 'cancelled'
    )
);

create unique index officer_invites_auth_user_id_key
on public.officer_invites (auth_user_id)
where auth_user_id is not null;

create unique index officer_invites_live_email_key
on public.officer_invites (email)
where status in ('preparing', 'sent', 'cleanup_pending');

create index officer_invites_preparing_role_committee_idx
on public.officer_invites (officer_role, committee_id)
where status = 'preparing';

alter table public.officer_invites enable row level security;
revoke all on table public.officer_invites from public, anon, authenticated;

create function public.officer_advisory_lock_key()
returns bigint
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.hashtextextended('ceit-connect:officer-writes:v1', 0);
$$;

create function public.officer_require_active_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
begin
  v_caller_id := auth.uid();

  if v_caller_id is null or not exists (
    select 1
    from public.users as caller
    where caller.id = v_caller_id
      and caller.role = 'Admin'
      and caller.is_active
  ) then
    raise exception using
      errcode = 'CCO01',
      message = 'Only an active Admin can perform this officer operation.';
  end if;

  return v_caller_id;
end;
$$;

create function public.officer_caps_are_enabled()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_enabled boolean;
begin
  select pg_catalog.count(*)::integer,
         pg_catalog.bool_and(setting.enforce_officer_role_caps)
  into v_count, v_enabled
  from public.app_settings as setting
  where setting.key = 'global';

  if v_count <> 1 or v_enabled is null then
    raise exception using
      errcode = 'CCO05',
      message = 'Officer settings are unavailable.';
  end if;

  return v_enabled;
end;
$$;

create function public.officer_committee_exists(p_committee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_committee_id is not null and exists (
    select 1 from public.committees as committee
    where committee.id = p_committee_id
  );
$$;

create function public.guard_officer_user_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_writer text := pg_catalog.current_setting(
    'ceit_connect.officer_writer', true
  );
  v_internal boolean := current_user = 'postgres';
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'CCO08',
      message = 'User profiles cannot be deleted.';
  end if;

  if tg_op = 'INSERT' then
    if new.role in ('Admin', 'Co-Admin')
       and not (
         v_internal and v_writer = 'invite_new_officer'
       ) then
      raise exception using
        errcode = 'CCO08',
        message = 'Officer profiles must be created through the officer invitation function.';
    end if;
    return new;
  end if;

  if new.role is distinct from old.role then
    if not (
      v_internal
      and v_writer in (
        'appoint_member_as_officer',
        'return_coadmin_to_member',
        'step_down_as_admin'
      )
    ) then
      raise exception using
        errcode = 'CCO08',
        message = 'Officer roles must be changed through an officer transition function.';
    end if;
  end if;

  if new.committee_id is distinct from old.committee_id then
    if not (
      v_internal
      and v_writer in (
        'appoint_member_as_officer',
        'return_coadmin_to_member',
        'move_member_to_committee',
        'step_down_as_admin'
      )
    ) then
      raise exception using
        errcode = 'CCO08',
        message = 'Committee changes must use an approved transition function.';
    end if;
  end if;

  if new.is_active is distinct from old.is_active
     and (old.role in ('Admin', 'Co-Admin')
          or new.role in ('Admin', 'Co-Admin')) then
    if not (
      v_internal
      and v_writer in ('cancel_officer_invite', 'set_officer_active')
    ) then
      raise exception using
        errcode = 'CCO08',
        message = 'Officer active state must use an approved officer function.';
    end if;
  end if;

  return new;
end;
$$;

create trigger users_guard_officer_writes
before insert or update or delete on public.users
for each row execute function public.guard_officer_user_writes();

create function public.invite_new_officer(
  p_invite_id uuid,
  p_auth_user_id uuid default null,
  p_email text default null,
  p_full_name text default null,
  p_role text default null,
  p_committee_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_caps_enabled boolean;
  v_invite public.officer_invites%rowtype;
  v_email text;
  v_full_name text;
  v_auth_email text;
  v_active_count integer;
  v_preparing_count integer;
  v_affected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    public.officer_advisory_lock_key()
  );
  v_caller_id := public.officer_require_active_admin();
  v_caps_enabled := public.officer_caps_are_enabled();

  if p_invite_id is null then
    raise exception using errcode = 'CCO02', message = 'Invitation id is required.';
  end if;

  -- A null Auth id is the preparation phase. It is the only phase allowed to
  -- accept person details from the caller.
  if p_auth_user_id is null then
    v_email := pg_catalog.lower(pg_catalog.btrim(p_email));
    v_full_name := pg_catalog.btrim(p_full_name);

    if v_email is null
       or v_email = ''
       or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
       or v_full_name is null
       or pg_catalog.char_length(v_full_name) not between 1 and 100
       or v_full_name ~ '[[:cntrl:]]'
       or p_role is null
       or p_role not in ('Admin', 'Co-Admin') then
      raise exception using
        errcode = 'CCO02',
        message = 'Officer invitation details are invalid.';
    end if;

    if (p_role = 'Admin' and p_committee_id is not null)
       or (p_role = 'Co-Admin'
           and not public.officer_committee_exists(p_committee_id)) then
      raise exception using
        errcode = 'CCO02',
        message = 'The selected officer committee is invalid.';
    end if;

    select invitation.* into v_invite
    from public.officer_invites as invitation
    where invitation.email = v_email
      and invitation.status in ('preparing', 'sent', 'cleanup_pending')
    order by invitation.id
    limit 1
    for update;

    if found then
      if v_invite.status = 'preparing'
         and v_invite.created_at <= pg_catalog.now() - interval '15 minutes' then
        update public.officer_invites
        set status = 'cleanup_pending',
            failure_code = 'stale_preparing',
            reservation_released_at = coalesce(
              reservation_released_at, pg_catalog.now()
            )
        where id = v_invite.id
          and status = 'preparing';

        get diagnostics v_affected = row_count;
        if v_affected <> 1 then
          raise exception using
            errcode = 'CCO06', message = 'Invitation cleanup state changed unexpectedly.';
        end if;

        return pg_catalog.jsonb_build_object(
          'outcome', 'cleanup_pending',
          'invite_id', v_invite.id,
          'failure_code', 'stale_preparing'
        );
      end if;

      if v_invite.id = p_invite_id and v_invite.status = 'preparing' then
        return pg_catalog.jsonb_build_object(
          'outcome', 'prepared', 'invite_id', v_invite.id
        );
      end if;

      return pg_catalog.jsonb_build_object(
        'outcome', v_invite.status,
        'invite_id', v_invite.id
      );
    end if;

    if exists (
      select 1 from public.users as profile
      where pg_catalog.lower(pg_catalog.btrim(profile.email)) = v_email
    ) or exists (
      select 1 from auth.users as auth_user
      where pg_catalog.lower(pg_catalog.btrim(auth_user.email)) = v_email
    ) then
      raise exception using
        errcode = 'CCO03',
        message = 'An account already exists for this email.';
    end if;

    if v_caps_enabled then
      if p_role = 'Admin' then
        select pg_catalog.count(*)::integer into v_active_count
        from public.users as profile
        where profile.role = 'Admin' and profile.is_active;

        select pg_catalog.count(*)::integer into v_preparing_count
        from public.officer_invites as invitation
        where invitation.status = 'preparing'
          and invitation.created_at > pg_catalog.now() - interval '15 minutes'
          and invitation.officer_role = 'Admin';

        if v_active_count + v_preparing_count >= 2 then
          raise exception using
            errcode = 'CCO04', message = 'All active Admin seats are filled.';
        end if;
      else
        select pg_catalog.count(*)::integer into v_active_count
        from public.users as profile
        where profile.role = 'Co-Admin'
          and profile.committee_id = p_committee_id
          and profile.is_active;

        select pg_catalog.count(*)::integer into v_preparing_count
        from public.officer_invites as invitation
        where invitation.status = 'preparing'
          and invitation.created_at > pg_catalog.now() - interval '15 minutes'
          and invitation.officer_role = 'Co-Admin'
          and invitation.committee_id = p_committee_id;

        if v_active_count + v_preparing_count >= 1 then
          raise exception using
            errcode = 'CCO04', message = 'This committee officer seat is filled.';
        end if;
      end if;
    end if;

    insert into public.officer_invites (
      id, email, full_name, officer_role, committee_id, invited_by, status
    ) values (
      p_invite_id, v_email, v_full_name, p_role,
      case when p_role = 'Admin' then null else p_committee_id end,
      v_caller_id, 'preparing'
    );

    return pg_catalog.jsonb_build_object(
      'outcome', 'prepared', 'invite_id', p_invite_id
    );
  end if;

  -- Finalization trusts only the stored preparation plus auth.users. Caller
  -- supplied person details are forbidden and ignored nowhere.
  if p_email is not null or p_full_name is not null
     or p_role is not null or p_committee_id is not null then
    raise exception using
      errcode = 'CCO02',
      message = 'Finalization accepts only the invitation and Auth user ids.';
  end if;

  select invitation.* into v_invite
  from public.officer_invites as invitation
  where invitation.id = p_invite_id
  for update;

  if not found then
    raise exception using errcode = 'CCO03', message = 'Invitation not found.';
  end if;

  if v_invite.status <> 'preparing' then
    if v_invite.status = 'sent' and v_invite.auth_user_id = p_auth_user_id then
      return pg_catalog.jsonb_build_object(
        'outcome', 'sent', 'invite_id', v_invite.id,
        'user_id', v_invite.auth_user_id
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'outcome', v_invite.status, 'invite_id', v_invite.id
    );
  end if;

  if v_invite.created_at <= pg_catalog.now() - interval '15 minutes' then
    update public.officer_invites
    set status = 'cleanup_pending',
        failure_code = 'stale_preparing',
        reservation_released_at = coalesce(
          reservation_released_at, pg_catalog.now()
        )
    where id = v_invite.id and status = 'preparing';

    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using
        errcode = 'CCO06', message = 'Invitation cleanup state changed unexpectedly.';
    end if;

    return pg_catalog.jsonb_build_object(
      'outcome', 'cleanup_pending',
      'invite_id', v_invite.id,
      'failure_code', 'stale_preparing'
    );
  end if;

  select pg_catalog.lower(pg_catalog.btrim(auth_user.email))
  into v_auth_email
  from auth.users as auth_user
  where auth_user.id = p_auth_user_id;

  if not found or v_auth_email is distinct from v_invite.email then
    raise exception using
      errcode = 'CCO03',
      message = 'The Auth invitation does not match the prepared email.';
  end if;

  if exists (
    select 1 from public.users as profile
    where profile.id = p_auth_user_id
       or pg_catalog.lower(pg_catalog.btrim(profile.email)) = v_invite.email
  ) then
    raise exception using
      errcode = 'CCO03',
      message = 'A profile already exists for this invitation.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'invite_new_officer', true
  );
  insert into public.users (
    id, email, full_name, role, committee_id, is_active
  ) values (
    p_auth_user_id,
    v_invite.email,
    v_invite.full_name,
    v_invite.officer_role,
    v_invite.committee_id,
    true
  );
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  update public.officer_invites
  set auth_user_id = p_auth_user_id,
      status = 'sent',
      sent_at = pg_catalog.now(),
      reservation_released_at = coalesce(
        reservation_released_at, pg_catalog.now()
      ),
      failure_code = null
  where id = v_invite.id and status = 'preparing';

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCO06', message = 'Invitation finalization changed unexpectedly.';
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'sent', 'invite_id', v_invite.id,
    'user_id', p_auth_user_id
  );
end;
$$;

create function public.appoint_member_as_officer(
  p_user_id uuid,
  p_role text,
  p_committee_id uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caps_enabled boolean;
  v_target public.users%rowtype;
  v_active_count integer;
  v_preparing_count integer;
  v_affected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(public.officer_advisory_lock_key());
  perform public.officer_require_active_admin();
  v_caps_enabled := public.officer_caps_are_enabled();

  if p_user_id is null
     or p_role is null
     or p_role not in ('Admin', 'Co-Admin') then
    raise exception using errcode = 'CCO02', message = 'Appointment details are invalid.';
  end if;
  if (p_role = 'Admin' and p_committee_id is not null)
     or (p_role = 'Co-Admin'
         and not public.officer_committee_exists(p_committee_id)) then
    raise exception using errcode = 'CCO02', message = 'The selected officer committee is invalid.';
  end if;

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found or v_target.role <> 'Member' or not v_target.is_active then
    raise exception using
      errcode = 'CCO03', message = 'Only an active Member can be appointed.';
  end if;

  if v_caps_enabled then
    if p_role = 'Admin' then
      select pg_catalog.count(*)::integer into v_active_count
      from public.users as profile
      where profile.role = 'Admin' and profile.is_active;
      select pg_catalog.count(*)::integer into v_preparing_count
      from public.officer_invites as invitation
      where invitation.status = 'preparing'
        and invitation.created_at > pg_catalog.now() - interval '15 minutes'
        and invitation.officer_role = 'Admin';
      if v_active_count + v_preparing_count >= 2 then
        raise exception using errcode = 'CCO04', message = 'All active Admin seats are filled.';
      end if;
    else
      select pg_catalog.count(*)::integer into v_active_count
      from public.users as profile
      where profile.role = 'Co-Admin'
        and profile.committee_id = p_committee_id
        and profile.is_active;
      select pg_catalog.count(*)::integer into v_preparing_count
      from public.officer_invites as invitation
      where invitation.status = 'preparing'
        and invitation.created_at > pg_catalog.now() - interval '15 minutes'
        and invitation.officer_role = 'Co-Admin'
        and invitation.committee_id = p_committee_id;
      if v_active_count + v_preparing_count >= 1 then
        raise exception using errcode = 'CCO04', message = 'This committee officer seat is filled.';
      end if;
    end if;
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'appoint_member_as_officer', true
  );
  update public.users
  set role = p_role,
      committee_id = case when p_role = 'Admin' then null else p_committee_id end
  where id = p_user_id and role = 'Member' and is_active;
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Appointment changed unexpectedly.';
  end if;
end;
$$;

create function public.return_coadmin_to_member(
  p_user_id uuid,
  p_committee_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target public.users%rowtype;
  v_affected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(public.officer_advisory_lock_key());
  perform public.officer_require_active_admin();
  perform public.officer_caps_are_enabled();

  if not public.officer_committee_exists(p_committee_id) then
    raise exception using errcode = 'CCO02', message = 'The selected member committee is invalid.';
  end if;

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found or v_target.role <> 'Co-Admin' then
    raise exception using errcode = 'CCO03', message = 'The target is not a Co-Admin.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'return_coadmin_to_member', true
  );
  update public.users
  set role = 'Member', committee_id = p_committee_id
  where id = p_user_id and role = 'Co-Admin';
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Role return changed unexpectedly.';
  end if;
end;
$$;

create function public.move_member_to_committee(
  p_user_id uuid,
  p_committee_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target public.users%rowtype;
  v_affected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(public.officer_advisory_lock_key());
  perform public.officer_require_active_admin();
  perform public.officer_caps_are_enabled();

  if not public.officer_committee_exists(p_committee_id) then
    raise exception using errcode = 'CCO02', message = 'The selected member committee is invalid.';
  end if;

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found or v_target.role <> 'Member' then
    raise exception using errcode = 'CCO03', message = 'Only a Member can be moved.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'move_member_to_committee', true
  );
  update public.users
  set committee_id = p_committee_id
  where id = p_user_id and role = 'Member';
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Committee move changed unexpectedly.';
  end if;
end;
$$;

create function public.cancel_officer_invite(p_invite_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invite public.officer_invites%rowtype;
  v_auth_user_id uuid;
  v_email_confirmed_at timestamptz;
  v_profile_exists boolean;
  v_affected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(public.officer_advisory_lock_key());
  perform public.officer_require_active_admin();
  perform public.officer_caps_are_enabled();

  select invitation.* into v_invite
  from public.officer_invites as invitation
  where invitation.id = p_invite_id
  for update;

  if not found then
    raise exception using errcode = 'CCO03', message = 'Invitation not found.';
  end if;

  select auth_user.id, auth_user.email_confirmed_at
  into v_auth_user_id, v_email_confirmed_at
  from auth.users as auth_user
  where (v_invite.auth_user_id is not null
         and auth_user.id = v_invite.auth_user_id)
     or (v_invite.auth_user_id is null
         and pg_catalog.lower(pg_catalog.btrim(auth_user.email)) = v_invite.email)
  order by auth_user.id
  limit 1;

  if v_email_confirmed_at is not null then
    raise exception using
      errcode = 'CCO07', message = 'An accepted officer invitation cannot be cancelled.';
  end if;

  select exists (
    select 1 from public.users as profile
    where profile.id = v_auth_user_id
       or pg_catalog.lower(pg_catalog.btrim(profile.email)) = v_invite.email
  ) into v_profile_exists;

  if v_profile_exists then
    perform pg_catalog.set_config(
      'ceit_connect.officer_writer', 'cancel_officer_invite', true
    );
    update public.users
    set is_active = false, avatar_url = null
    where id = v_auth_user_id
      and is_active;
    get diagnostics v_affected = row_count;
    perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

    if v_affected not in (0, 1) then
      raise exception using errcode = 'CCO06', message = 'Invitation cancellation changed unexpectedly.';
    end if;
  end if;

  if v_invite.status <> 'cancelled' then
    update public.officer_invites
    set status = 'cancelled',
        reservation_released_at = coalesce(
          reservation_released_at, pg_catalog.now()
        ),
        cancelled_at = coalesce(cancelled_at, pg_catalog.now())
    where id = v_invite.id;

    get diagnostics v_affected = row_count;
    if v_affected <> 1 then
      raise exception using errcode = 'CCO06', message = 'Invitation cancellation changed unexpectedly.';
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'cancelled',
    'invite_id', v_invite.id,
    'auth_user_id', v_auth_user_id,
    'cleanup_action', case
      when v_auth_user_id is null then 'none'
      when v_profile_exists then 'revoke'
      else 'delete_new_attempt'
    end
  );
end;
$$;

create function public.step_down_as_admin(p_committee_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid;
  v_active_admins integer;
  v_affected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(public.officer_advisory_lock_key());
  v_caller_id := public.officer_require_active_admin();
  perform public.officer_caps_are_enabled();

  if not public.officer_committee_exists(p_committee_id) then
    raise exception using errcode = 'CCO02', message = 'The selected member committee is invalid.';
  end if;

  perform 1
  from public.users as profile
  where profile.id = v_caller_id
  for update;

  select pg_catalog.count(*)::integer into v_active_admins
  from public.users as profile
  join auth.users as auth_user on auth_user.id = profile.id
  where profile.role = 'Admin'
    and profile.is_active
    and profile.id <> v_caller_id
    and auth_user.email_confirmed_at is not null;

  if v_active_admins < 1 then
    raise exception using
      errcode = 'CCO09', message = 'The last active Admin cannot step down.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'step_down_as_admin', true
  );
  update public.users
  set role = 'Member', committee_id = p_committee_id
  where id = v_caller_id and role = 'Admin' and is_active;
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Admin step-down changed unexpectedly.';
  end if;
end;
$$;

create function public.set_officer_active(
  p_user_id uuid,
  p_is_active boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caps_enabled boolean;
  v_target public.users%rowtype;
  v_active_count integer;
  v_preparing_count integer;
  v_affected integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(public.officer_advisory_lock_key());
  perform public.officer_require_active_admin();
  v_caps_enabled := public.officer_caps_are_enabled();

  if p_user_id is null or p_is_active is null then
    raise exception using errcode = 'CCO02', message = 'Officer active-state details are invalid.';
  end if;

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found or v_target.role <> 'Co-Admin' then
    raise exception using
      errcode = 'CCO03', message = 'Only a Co-Admin can use the officer active-state function.';
  end if;

  if v_target.is_active = p_is_active then
    return;
  end if;

  if p_is_active and exists (
    select 1
    from public.officer_invites as invitation
    join auth.users as auth_user on auth_user.id = invitation.auth_user_id
    where invitation.auth_user_id = p_user_id
      and invitation.status = 'cancelled'
      and auth_user.email_confirmed_at is null
  ) then
    raise exception using
      errcode = 'CCO03', message = 'A cancelled officer invitation cannot be reactivated.';
  end if;

  if not p_is_active and exists (
    select 1
    from public.officer_invites as invitation
    join auth.users as auth_user on auth_user.id = invitation.auth_user_id
    where invitation.auth_user_id = p_user_id
      and invitation.status = 'sent'
      and auth_user.email_confirmed_at is null
  ) then
    raise exception using
      errcode = 'CCO03', message = 'Use invitation cancellation for an unaccepted officer invite.';
  end if;

  if p_is_active and v_caps_enabled then
    select pg_catalog.count(*)::integer into v_active_count
    from public.users as profile
    where profile.role = 'Co-Admin'
      and profile.committee_id = v_target.committee_id
      and profile.is_active;
    select pg_catalog.count(*)::integer into v_preparing_count
    from public.officer_invites as invitation
    where invitation.status = 'preparing'
      and invitation.created_at > pg_catalog.now() - interval '15 minutes'
      and invitation.officer_role = 'Co-Admin'
      and invitation.committee_id = v_target.committee_id;
    if v_active_count + v_preparing_count >= 1 then
      raise exception using errcode = 'CCO04', message = 'This committee officer seat is filled.';
    end if;
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'set_officer_active', true
  );
  update public.users
  set is_active = p_is_active,
      avatar_url = case when p_is_active then avatar_url else null end
  where id = p_user_id and role = 'Co-Admin';
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Officer active state changed unexpectedly.';
  end if;
end;
$$;

create function public.list_pending_officer_invites()
returns table (
  id uuid,
  auth_user_id uuid,
  email text,
  full_name text,
  officer_role text,
  committee_id uuid,
  status text,
  created_at timestamptz,
  cleanup_pending boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.officer_require_active_admin();

  return query
  select invitation.id,
         invitation.auth_user_id,
         invitation.email,
         invitation.full_name,
         invitation.officer_role,
         invitation.committee_id,
         invitation.status,
         invitation.created_at,
         invitation.status = 'cleanup_pending'
  from public.officer_invites as invitation
  left join auth.users as auth_user on auth_user.id = invitation.auth_user_id
  where invitation.status in ('preparing', 'sent', 'cleanup_pending')
    and (invitation.auth_user_id is null
         or auth_user.email_confirmed_at is null)
  order by invitation.created_at, invitation.id;
end;
$$;

drop policy "admin_full_access_users" on public.users;

create policy "admin_view_all_users"
on public.users for select
to authenticated
using (public.my_role() = 'Admin');

revoke insert, update, delete on table public.users
from public, anon, authenticated;

alter function public.officer_advisory_lock_key() owner to postgres;
alter function public.officer_require_active_admin() owner to postgres;
alter function public.officer_caps_are_enabled() owner to postgres;
alter function public.officer_committee_exists(uuid) owner to postgres;
alter function public.guard_officer_user_writes() owner to postgres;
alter function public.invite_new_officer(uuid,uuid,text,text,text,uuid) owner to postgres;
alter function public.appoint_member_as_officer(uuid,text,uuid) owner to postgres;
alter function public.return_coadmin_to_member(uuid,uuid) owner to postgres;
alter function public.move_member_to_committee(uuid,uuid) owner to postgres;
alter function public.cancel_officer_invite(uuid) owner to postgres;
alter function public.step_down_as_admin(uuid) owner to postgres;
alter function public.set_officer_active(uuid,boolean) owner to postgres;
alter function public.list_pending_officer_invites() owner to postgres;

revoke all on function public.officer_advisory_lock_key()
from public, anon, authenticated;
revoke all on function public.officer_require_active_admin()
from public, anon, authenticated;
revoke all on function public.officer_caps_are_enabled()
from public, anon, authenticated;
revoke all on function public.officer_committee_exists(uuid)
from public, anon, authenticated;
revoke all on function public.guard_officer_user_writes()
from public, anon, authenticated;
revoke all on function public.invite_new_officer(uuid,uuid,text,text,text,uuid)
from public, anon, authenticated;
revoke all on function public.appoint_member_as_officer(uuid,text,uuid)
from public, anon, authenticated;
revoke all on function public.return_coadmin_to_member(uuid,uuid)
from public, anon, authenticated;
revoke all on function public.move_member_to_committee(uuid,uuid)
from public, anon, authenticated;
revoke all on function public.cancel_officer_invite(uuid)
from public, anon, authenticated;
revoke all on function public.step_down_as_admin(uuid)
from public, anon, authenticated;
revoke all on function public.set_officer_active(uuid,boolean)
from public, anon, authenticated;
revoke all on function public.list_pending_officer_invites()
from public, anon, authenticated;

grant execute on function public.invite_new_officer(uuid,uuid,text,text,text,uuid)
to authenticated;
grant execute on function public.appoint_member_as_officer(uuid,text,uuid)
to authenticated;
grant execute on function public.return_coadmin_to_member(uuid,uuid)
to authenticated;
grant execute on function public.move_member_to_committee(uuid,uuid)
to authenticated;
grant execute on function public.cancel_officer_invite(uuid)
to authenticated;
grant execute on function public.step_down_as_admin(uuid)
to authenticated;
grant execute on function public.set_officer_active(uuid,boolean)
to authenticated;
grant execute on function public.list_pending_officer_invites()
to authenticated;

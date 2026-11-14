create function public.guard_president_committee_admin()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.committees as committee_row
    where committee_row.id = new.committee_id
      and committee_row.name = 'President'
  ) then
    return new;
  end if;

  if new.role = 'Admin' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.role is not distinct from old.role
       and new.committee_id is not distinct from old.committee_id then
      return new;
    end if;
  end if;

  raise exception using
    errcode = 'CCG01',
    message = 'Only Admins can be assigned to the President committee.';
end;
$$;

alter function public.guard_president_committee_admin() owner to postgres;
revoke all on function public.guard_president_committee_admin()
from public, anon, authenticated, service_role;

create trigger users_guard_president_committee
before insert or update on public.users
for each row execute function public.guard_president_committee_admin();

create or replace function public.invite_new_officer(
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
  v_caller_id := public.officer_require_active_admin();

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

    if p_role is distinct from 'Admin'
       and exists (
         select 1
         from public.committees as committee_row
         where committee_row.id = p_committee_id
           and committee_row.name = 'President'
       ) then
      raise exception using
        errcode = 'CCG01',
        message = 'Only Admins can be assigned to the President committee.';
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

alter function public.invite_new_officer(uuid,uuid,text,text,text,uuid)
owner to postgres;
revoke all on function public.invite_new_officer(uuid,uuid,text,text,text,uuid)
from public, anon, authenticated, service_role;
grant execute on function public.invite_new_officer(uuid,uuid,text,text,text,uuid)
to authenticated;

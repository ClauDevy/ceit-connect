-- Phase 4B Batch 10, Stage A2: permanent former-member anonymization.
--
-- Lock order:
-- * existing officer/member transition functions retain their officer advisory
--   lock first, then take the target per-user advisory lock, then the users row;
-- * anonymize_former_member takes the target per-user advisory lock, then the
--   users row, then performs task/event reads;
-- * no function in this migration takes a per-user lock before an officer lock.
--
-- The users trigger makes anonymized_at immutable and rejects every attempted
-- reactivation of an anonymized row, including raw postgres and service-role
-- updates. Only a superuser deliberately disabling the trigger can bypass that
-- enforcement boundary.
--
-- Latest replaced definitions copied from:
-- * guard_officer_user_writes, appoint_member_as_officer,
--   return_coadmin_to_member, move_member_to_committee, and
--   set_officer_active: 20261026120000_officer_invitations_and_transitions.sql;
-- * reactivate_committee_member and update_committee_member_full_name:
--   20261026150000_coadmin_user_management.sql.

do $$
begin
  if current_user <> 'postgres' then
    raise exception
      'Batch 10 Stage A2 must be applied by postgres; current_user is %.',
      current_user;
  end if;
end
$$;

alter table public.users
add column anonymized_at timestamptz null;

alter table public.users
add constraint users_anonymized_terminal_state_check
check (
  anonymized_at is null
  or (
    is_active is false
    and full_name = 'Former member'
    and email = id::text || '@former.invalid'
    and avatar_url is null
    and discord_id is null
  )
);

create or replace function public.guard_officer_user_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_writer text := pg_catalog.current_setting(
    'ceit_connect.officer_writer', true
  );
  v_former_writer text := pg_catalog.current_setting(
    'ceit_connect.former_member_writer', true
  );
  v_internal boolean := current_user = 'postgres';
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = 'CCO08',
      message = 'User profiles cannot be deleted.';
  end if;

  if tg_op = 'INSERT' then
    if new.anonymized_at is not null then
      raise exception using
        errcode = 'CMR04',
        message = 'Anonymized profiles can only be created by anonymizing an existing profile.';
    end if;

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

  if old.anonymized_at is not null then
    if new.anonymized_at is distinct from old.anonymized_at then
      raise exception using
        errcode = 'CMR04',
        message = 'Anonymization is permanent and its timestamp is immutable.';
    end if;

    if new.is_active is true then
      raise exception using
        errcode = 'CMR04',
        message = 'An anonymized profile can never be reactivated.';
    end if;
  elsif new.anonymized_at is not null then
    if not (
      v_internal
      and v_former_writer = 'anonymize_former_member'
    ) then
      raise exception using
        errcode = 'CMR04',
        message = 'Profiles can only be anonymized through the approved function.';
    end if;

    if new.role is distinct from old.role
       or new.committee_id is distinct from old.committee_id then
      raise exception using
        errcode = 'CMR04',
        message = 'Anonymization must preserve role and committee history.';
    end if;
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


create or replace function public.return_coadmin_to_member(
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

  if p_user_id is null then
    raise exception using errcode = 'CCO02', message = 'The target user is invalid.';
  end if;

  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'CCO03', message = 'The target is not a Co-Admin.';
  end if;

  if v_target.anonymized_at is not null then
    raise exception using
      errcode = 'CMR04', message = 'An anonymized profile cannot change role.';
  end if;

  if v_target.role <> 'Co-Admin' then
    raise exception using errcode = 'CCO03', message = 'The target is not a Co-Admin.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'return_coadmin_to_member', true
  );
  update public.users
  set role = 'Member', committee_id = p_committee_id
  where id = p_user_id
    and role = 'Co-Admin'
    and anonymized_at is null;
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Role return changed unexpectedly.';
  end if;
end;
$$;

alter function public.guard_officer_user_writes() owner to postgres;
revoke all on function public.guard_officer_user_writes()
from public, anon, authenticated;

create function public.former_member_eligibility(p_user_id uuid)
returns table (
  out_user_id uuid,
  out_full_name text,
  out_email text,
  out_role text,
  out_committee_id uuid,
  out_is_active boolean,
  out_anonymized_at timestamptz,
  out_open_task_count bigint,
  out_outcome text,
  out_reason_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_target public.users%rowtype;
begin
  out_user_id := p_user_id;
  out_open_task_count := 0;

  select profile.*
  into v_target
  from public.users as profile
  where profile.id = p_user_id;

  if not found then
    out_outcome := 'skipped';
    out_reason_code := 'unavailable';
    return next;
    return;
  end if;

  out_full_name := v_target.full_name;
  out_email := v_target.email;
  out_role := v_target.role;
  out_committee_id := v_target.committee_id;
  out_is_active := v_target.is_active;
  out_anonymized_at := v_target.anonymized_at;

  if v_target.id = auth.uid() then
    out_outcome := 'skipped';
    out_reason_code := 'self';
    return next;
    return;
  end if;

  if v_target.role = 'Admin' then
    out_outcome := 'skipped';
    out_reason_code := 'admin';
    return next;
    return;
  end if;

  if v_target.anonymized_at is not null then
    if v_target.is_active is not false
       or v_target.full_name <> 'Former member'
       or v_target.email <> v_target.id::text || '@former.invalid'
       or v_target.avatar_url is not null
       or v_target.discord_id is not null then
      raise exception using
        errcode = 'CMR03',
        message = 'The target profile is in an inconsistent anonymized state.';
    end if;

    out_outcome := 'already_anonymized';
    out_reason_code := 'already_anonymized';
    return next;
    return;
  end if;

  if v_target.is_active then
    out_outcome := 'skipped';
    out_reason_code := 'active';
    return next;
    return;
  end if;

  select pg_catalog.count(*)::bigint
  into out_open_task_count
  from public.tasks as task_row
  join public.events as event_row on event_row.id = task_row.event_id
  where task_row.status in ('To Do', 'In Progress')
    and event_row.status in ('Draft', 'Active')
    and (
      p_user_id = any(task_row.primary_assignees)
      or p_user_id = any(task_row.assist_assignees)
    );

  if out_open_task_count > 0 then
    out_outcome := 'skipped';
    out_reason_code := 'open_tasks';
  else
    out_outcome := 'eligible';
    out_reason_code := 'eligible';
  end if;

  return next;
end;
$$;

alter function public.former_member_eligibility(uuid) owner to postgres;
revoke all on function public.former_member_eligibility(uuid)
from public, anon, authenticated;

create function public.preview_former_member_removal(p_user_ids uuid[])
returns table (
  input_ordinal integer,
  user_id uuid,
  full_name text,
  email text,
  role text,
  committee_id uuid,
  is_active boolean,
  anonymized_at timestamptz,
  open_task_count bigint,
  outcome text,
  reason_code text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.users as caller
    where caller.id = auth.uid()
      and caller.role = 'Admin'
      and caller.is_active
      and caller.anonymized_at is null
  ) then
    raise exception using
      errcode = 'CMR01',
      message = 'Only an active Admin can preview former-member removal.';
  end if;

  if p_user_ids is null
     or pg_catalog.cardinality(p_user_ids) not between 1 and 50
     or pg_catalog.array_position(p_user_ids, null::uuid) is not null
     or pg_catalog.cardinality(p_user_ids) <> (
       select pg_catalog.count(distinct requested.user_id)::integer
       from pg_catalog.unnest(p_user_ids) as requested(user_id)
     ) then
    raise exception using
      errcode = 'CMR02',
      message = 'Select between 1 and 50 unique user IDs.';
  end if;

  return query
  select requested.ordinality::integer,
         eligibility.out_user_id,
         eligibility.out_full_name,
         eligibility.out_email,
         eligibility.out_role,
         eligibility.out_committee_id,
         eligibility.out_is_active,
         eligibility.out_anonymized_at,
         eligibility.out_open_task_count,
         eligibility.out_outcome,
         eligibility.out_reason_code
  from pg_catalog.unnest(p_user_ids)
    with ordinality as requested(user_id, ordinality)
  cross join lateral public.former_member_eligibility(
    requested.user_id
  ) as eligibility
  order by requested.ordinality;
end;
$$;

alter function public.preview_former_member_removal(uuid[]) owner to postgres;
revoke all on function public.preview_former_member_removal(uuid[])
from public, anon, authenticated;
grant execute on function public.preview_former_member_removal(uuid[])
to authenticated;

create function public.anonymize_former_member(p_user_id uuid)
returns table (
  out_user_id uuid,
  out_outcome text,
  out_reason_code text,
  out_email text,
  out_anonymized_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_target public.users%rowtype;
  v_eligibility record;
  v_now timestamptz;
  v_affected integer;
begin
  if not exists (
    select 1
    from public.users as caller
    where caller.id = auth.uid()
      and caller.role = 'Admin'
      and caller.is_active
      and caller.anonymized_at is null
  ) then
    raise exception using
      errcode = 'CMR01',
      message = 'Only an active Admin can anonymize a former member.';
  end if;

  if p_user_id is null then
    raise exception using
      errcode = 'CMR02',
      message = 'A target user ID is required.';
  end if;

  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);

  select profile.*
  into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'CMR03',
      message = 'The target profile is unavailable.';
  end if;

  select eligibility.*
  into v_eligibility
  from public.former_member_eligibility(p_user_id) as eligibility;

  if not found or v_eligibility.out_user_id is distinct from p_user_id then
    raise exception using
      errcode = 'CMR03',
      message = 'The target profile state is unavailable.';
  end if;

  out_user_id := p_user_id;

  if v_eligibility.out_outcome = 'already_anonymized' then
    out_outcome := 'already_anonymized';
    out_reason_code := 'already_anonymized';
    out_email := v_eligibility.out_email;
    out_anonymized_at := v_eligibility.out_anonymized_at;
    return next;
    return;
  end if;

  if v_eligibility.out_outcome <> 'eligible' then
    out_outcome := 'skipped';
    out_reason_code := v_eligibility.out_reason_code;
    out_email := v_eligibility.out_email;
    out_anonymized_at := v_eligibility.out_anonymized_at;
    return next;
    return;
  end if;

  v_now := pg_catalog.clock_timestamp();
  begin
    perform pg_catalog.set_config(
      'ceit_connect.former_member_writer', 'anonymize_former_member', true
    );

    update public.users as profile
    set email = profile.id::text || '@former.invalid',
        full_name = 'Former member',
        avatar_url = null,
        discord_id = null,
        is_active = false,
        anonymized_at = v_now
    where profile.id = p_user_id
      and profile.anonymized_at is null
      and profile.is_active is false
      and profile.role <> 'Admin'
      and not exists (
        select 1
        from public.tasks as task_row
        join public.events as event_row on event_row.id = task_row.event_id
        where task_row.status in ('To Do', 'In Progress')
          and event_row.status in ('Draft', 'Active')
          and (
            profile.id = any(task_row.primary_assignees)
            or profile.id = any(task_row.assist_assignees)
          )
      );

    get diagnostics v_affected = row_count;
    perform pg_catalog.set_config(
      'ceit_connect.former_member_writer', '', true
    );
  exception
    when others then
      perform pg_catalog.set_config(
        'ceit_connect.former_member_writer', '', true
      );
      raise exception using
        errcode = 'CMR05',
        message = 'Anonymization failed before its invariant could be verified.';
  end;

  if v_affected <> 1 then
    raise exception using
      errcode = 'CMR05',
      message = 'Anonymization could not be completed safely.';
  end if;

  select profile.*
  into v_target
  from public.users as profile
  where profile.id = p_user_id;

  if not found
     or v_target.anonymized_at is distinct from v_now
     or v_target.is_active is not false
     or v_target.full_name <> 'Former member'
     or v_target.email <> p_user_id::text || '@former.invalid'
     or v_target.avatar_url is not null
     or v_target.discord_id is not null then
    raise exception using
      errcode = 'CMR05',
      message = 'The anonymized profile invariant was not preserved.';
  end if;

  out_outcome := 'anonymized';
  out_reason_code := 'anonymized';
  out_email := v_target.email;
  out_anonymized_at := v_target.anonymized_at;
  return next;
exception
  when others then
    perform pg_catalog.set_config('ceit_connect.former_member_writer', '', true);
    raise;
end;
$$;

alter function public.anonymize_former_member(uuid) owner to postgres;
revoke all on function public.anonymize_former_member(uuid)
from public, anon, authenticated;
grant execute on function public.anonymize_former_member(uuid)
to authenticated;

create or replace function public.appoint_member_as_officer(
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

  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'CCO03', message = 'Only an active Member can be appointed.';
  end if;

  if v_target.anonymized_at is not null then
    raise exception using
      errcode = 'CMR04', message = 'An anonymized profile cannot be appointed.';
  end if;

  if v_target.role <> 'Member' or not v_target.is_active then
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
  where id = p_user_id
    and role = 'Member'
    and is_active
    and anonymized_at is null;
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Appointment changed unexpectedly.';
  end if;
end;
$$;


create or replace function public.move_member_to_committee(
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

  if p_user_id is null then
    raise exception using errcode = 'CCO02', message = 'The target user is invalid.';
  end if;

  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'CCO03', message = 'Only a Member can be moved.';
  end if;

  if v_target.anonymized_at is not null then
    raise exception using
      errcode = 'CMR04', message = 'An anonymized profile cannot change committee.';
  end if;

  if v_target.role <> 'Member' then
    raise exception using errcode = 'CCO03', message = 'Only a Member can be moved.';
  end if;

  perform pg_catalog.set_config(
    'ceit_connect.officer_writer', 'move_member_to_committee', true
  );
  update public.users
  set committee_id = p_committee_id
  where id = p_user_id
    and role = 'Member'
    and anonymized_at is null;
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Committee move changed unexpectedly.';
  end if;
end;
$$;


create or replace function public.set_officer_active(
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

  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found then
    raise exception using
      errcode = 'CCO03', message = 'Only a Co-Admin can use the officer active-state function.';
  end if;

  if v_target.anonymized_at is not null then
    raise exception using
      errcode = 'CMR04', message = 'An anonymized officer can never change active state.';
  end if;

  if v_target.role <> 'Co-Admin' then
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
  where id = p_user_id
    and role = 'Co-Admin'
    and anonymized_at is null;
  get diagnostics v_affected = row_count;
  perform pg_catalog.set_config('ceit_connect.officer_writer', '', true);

  if v_affected <> 1 then
    raise exception using errcode = 'CCO06', message = 'Officer active state changed unexpectedly.';
  end if;
end;
$$;


create or replace function public.reactivate_committee_member(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_committee_id uuid;
  v_target public.users%rowtype;
  v_affected integer;
begin
  select caller.committee_id into v_caller_committee_id
  from public.users as caller
  where caller.id = v_caller_id
    and caller.role = 'Co-Admin'
    and caller.is_active
    and caller.committee_id is not null;

  if not found then
    raise exception using
      errcode = 'CCM01',
      message = 'Only an active Co-Admin can manage committee Members.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.officer_advisory_lock_key()
  );

  select caller.committee_id into v_caller_committee_id
  from public.users as caller
  where caller.id = v_caller_id
    and caller.role = 'Co-Admin'
    and caller.is_active
    and caller.committee_id is not null;

  if not found then
    raise exception using
      errcode = 'CCM01',
      message = 'Only an active Co-Admin can manage committee Members.';
  end if;

  if p_user_id is null then
    raise exception using
      errcode = 'CCM02',
      message = 'The selected Member is invalid.';
  end if;

  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found
     or v_target.role <> 'Member'
     or v_target.committee_id is distinct from v_caller_committee_id then
    raise exception using
      errcode = 'CCM03',
      message = 'The selected Member is unavailable.';
  end if;

  if v_target.anonymized_at is not null then
    raise exception using
      errcode = 'CMR04',
      message = 'An anonymized Member can never be reactivated.';
  end if;

  if v_target.is_active then
    raise exception using
      errcode = 'CCM04',
      message = 'The selected Member state has changed.';
  end if;

  update public.users
  set is_active = true
  where id = p_user_id
    and role = 'Member'
    and committee_id = v_caller_committee_id
    and not is_active
    and anonymized_at is null;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCM09',
      message = 'Member reactivation changed unexpectedly.';
  end if;
end;
$$;


create or replace function public.update_committee_member_full_name(
  p_user_id uuid,
  p_full_name text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_caller_committee_id uuid;
  v_target public.users%rowtype;
  v_full_name text;
  v_affected integer;
  -- Copied exactly from update_own_profile(text). Controls and U+2028/U+2029
  -- are rejected before trimming, so the allowed trim set is intentionally:
  -- SPACE, NBSP, OGHAM SPACE MARK, U+2000..U+200A, NNBSP, MMSP,
  -- IDEOGRAPHIC SPACE, and BOM/ZERO WIDTH NO-BREAK SPACE.
  v_trim_chars constant text :=
    ' '
    || pg_catalog.chr(160)
    || pg_catalog.chr(5760)
    || pg_catalog.chr(8192)
    || pg_catalog.chr(8193)
    || pg_catalog.chr(8194)
    || pg_catalog.chr(8195)
    || pg_catalog.chr(8196)
    || pg_catalog.chr(8197)
    || pg_catalog.chr(8198)
    || pg_catalog.chr(8199)
    || pg_catalog.chr(8200)
    || pg_catalog.chr(8201)
    || pg_catalog.chr(8202)
    || pg_catalog.chr(8239)
    || pg_catalog.chr(8287)
    || pg_catalog.chr(12288)
    || pg_catalog.chr(65279);
begin
  select caller.committee_id into v_caller_committee_id
  from public.users as caller
  where caller.id = v_caller_id
    and caller.role = 'Co-Admin'
    and caller.is_active
    and caller.committee_id is not null;

  if not found then
    raise exception using
      errcode = 'CCM01',
      message = 'Only an active Co-Admin can manage committee Members.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.officer_advisory_lock_key()
  );

  select caller.committee_id into v_caller_committee_id
  from public.users as caller
  where caller.id = v_caller_id
    and caller.role = 'Co-Admin'
    and caller.is_active
    and caller.committee_id is not null;

  if not found then
    raise exception using
      errcode = 'CCM01',
      message = 'Only an active Co-Admin can manage committee Members.';
  end if;

  if p_user_id is null then
    raise exception using
      errcode = 'CCM02',
      message = 'The selected Member is invalid.';
  end if;

  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);

  select profile.* into v_target
  from public.users as profile
  where profile.id = p_user_id
  for update;

  if not found
     or v_target.role <> 'Member'
     or v_target.committee_id is distinct from v_caller_committee_id then
    raise exception using
      errcode = 'CCM03',
      message = 'The selected Member is unavailable.';
  end if;

  if v_target.anonymized_at is not null then
    raise exception using
      errcode = 'CMR04',
      message = 'An anonymized Member name is immutable.';
  end if;

  -- This block is copied exactly from update_own_profile(text).
  if p_full_name is null
     or pg_catalog.char_length(p_full_name) > 1000 then
    raise exception using
      errcode = 'CCM05',
      message = 'Full name must be 1 to 100 characters and cannot contain control characters or line breaks.';
  end if;

  if p_full_name is null or exists (
    select 1
    from pg_catalog.generate_series(
      1,
      pg_catalog.char_length(p_full_name)
    ) as positions(character_position)
    where pg_catalog.ascii(
      pg_catalog.substr(p_full_name, character_position, 1)
    ) between 0 and 31
       or pg_catalog.ascii(
         pg_catalog.substr(p_full_name, character_position, 1)
       ) between 127 and 159
       or pg_catalog.ascii(
         pg_catalog.substr(p_full_name, character_position, 1)
       ) in (8232, 8233)
  ) then
    raise exception using
      errcode = 'CCM05',
      message = 'Full name must be 1 to 100 characters and cannot contain control characters or line breaks.';
  end if;

  v_full_name := pg_catalog.btrim(p_full_name, v_trim_chars);

  if pg_catalog.char_length(v_full_name) not between 1 and 100 then
    raise exception using
      errcode = 'CCM05',
      message = 'Full name must be 1 to 100 characters and cannot contain control characters or line breaks.';
  end if;

  update public.users
  set full_name = v_full_name
  where id = p_user_id
    and role = 'Member'
    and committee_id = v_caller_committee_id
    and anonymized_at is null;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCM09',
      message = 'Member name update changed unexpectedly.';
  end if;

  return v_full_name;
end;
$$;

alter function public.appoint_member_as_officer(uuid,text,uuid) owner to postgres;
alter function public.return_coadmin_to_member(uuid,uuid) owner to postgres;
alter function public.move_member_to_committee(uuid,uuid) owner to postgres;
alter function public.set_officer_active(uuid,boolean) owner to postgres;
alter function public.reactivate_committee_member(uuid) owner to postgres;
alter function public.update_committee_member_full_name(uuid,text) owner to postgres;

revoke all on function public.appoint_member_as_officer(uuid,text,uuid)
from public, anon, authenticated;
revoke all on function public.return_coadmin_to_member(uuid,uuid)
from public, anon, authenticated;
revoke all on function public.move_member_to_committee(uuid,uuid)
from public, anon, authenticated;
revoke all on function public.set_officer_active(uuid,boolean)
from public, anon, authenticated;
revoke all on function public.reactivate_committee_member(uuid)
from public, anon, authenticated;
revoke all on function public.update_committee_member_full_name(uuid,text)
from public, anon, authenticated;

grant execute on function public.appoint_member_as_officer(uuid,text,uuid)
to authenticated;
grant execute on function public.return_coadmin_to_member(uuid,uuid)
to authenticated;
grant execute on function public.move_member_to_committee(uuid,uuid)
to authenticated;
grant execute on function public.set_officer_active(uuid,boolean)
to authenticated;
grant execute on function public.reactivate_committee_member(uuid)
to authenticated;
grant execute on function public.update_committee_member_full_name(uuid,text)
to authenticated;

-- finalize_member_invite(uuid,text,text,uuid) and invite_new_officer(...)
-- intentionally remain unchanged. Anonymization replaces the old profile email
-- with <old UUID>@former.invalid, freeing the original address. A later invite
-- creates a new Auth user and profile under a new UUID; neither finalizer
-- reactivates, merges, or reuses the old anonymized UUID.

-- Batch A: allow one active Admin to manage another without weakening the
-- officer guard. Authorization always precedes the officer advisory lock;
-- every path then follows officer advisory -> sorted user locks.

create or replace function public.former_member_eligibility(p_user_id uuid)
returns table(out_user_id uuid,out_full_name text,out_email text,out_role text,out_committee_id uuid,out_is_active boolean,out_anonymized_at timestamptz,out_open_task_count bigint,out_outcome text,out_reason_code text)
language plpgsql stable security definer set search_path=''
as $$
declare v_target public.users%rowtype;
begin
  out_user_id:=p_user_id; out_open_task_count:=0;
  select * into v_target from public.users where id=p_user_id;
  if not found then out_outcome:='skipped';out_reason_code:='unavailable';return next;return;end if;
  out_full_name:=v_target.full_name;out_email:=v_target.email;out_role:=v_target.role;
  out_committee_id:=v_target.committee_id;out_is_active:=v_target.is_active;out_anonymized_at:=v_target.anonymized_at;
  if v_target.id=auth.uid() then out_outcome:='skipped';out_reason_code:='self';return next;return;end if;
  if v_target.anonymized_at is not null then
    if v_target.is_active is not false or v_target.full_name<>'Former member'
       or v_target.email<>v_target.id::text||'@former.invalid' or v_target.avatar_url is not null or v_target.discord_id is not null then
      raise exception using errcode='CMR03',message='The target profile is in an inconsistent anonymized state.';
    end if;
    out_outcome:='already_anonymized';out_reason_code:='already_anonymized';return next;return;
  end if;
  if v_target.is_active then out_outcome:='skipped';out_reason_code:='active';return next;return;end if;
  select count(*) into out_open_task_count
  from public.tasks task_row join public.events event_row on event_row.id=task_row.event_id
  where task_row.status in ('To Do','In Progress') and event_row.status in ('Draft','Active')
    and (p_user_id=any(task_row.primary_assignees) or p_user_id=any(task_row.assist_assignees));
  if out_open_task_count>0 then out_outcome:='skipped';out_reason_code:='open_tasks';
  else out_outcome:='eligible';out_reason_code:='eligible';end if;
  return next;
end;
$$;
alter function public.former_member_eligibility(uuid) owner to postgres;
revoke all on function public.former_member_eligibility(uuid) from public,anon,authenticated;

create or replace function public.set_officer_active(p_user_id uuid,p_is_active boolean)
returns void language plpgsql volatile security definer set search_path=''
as $$
declare v_target public.users%rowtype;v_caps boolean;v_active integer;v_preparing integer;v_affected integer;
begin
  -- Authorization and self rejection are deliberately before every lock.
  perform public.officer_require_active_admin();
  if p_user_id is null or p_is_active is null then raise exception using errcode='CCO02',message='Officer active-state details are invalid.';end if;
  if p_user_id=auth.uid() then raise exception using errcode='CCO03',message='Admins cannot change their own active state.';end if;
  perform pg_catalog.pg_advisory_xact_lock(public.officer_advisory_lock_key());
  -- The caller may have waited while another Admin deactivated them.
  perform public.officer_require_active_admin();
  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);
  select * into v_target from public.users where id=p_user_id for update;
  if not found or v_target.role not in ('Admin','Co-Admin') then
    raise exception using errcode='CCO03',message='Only an Admin or Co-Admin can use the officer active-state function.';
  end if;
  if v_target.anonymized_at is not null then raise exception using errcode='CMR04',message='An anonymized officer can never change active state.';end if;
  if v_target.is_active=p_is_active then return;end if;
  if p_is_active and exists(select 1 from public.officer_invites invitation join auth.users auth_user on auth_user.id=invitation.auth_user_id where invitation.auth_user_id=p_user_id and invitation.status='cancelled' and auth_user.email_confirmed_at is null) then
    raise exception using errcode='CCO03',message='A cancelled officer invitation cannot be reactivated.';
  end if;
  if not p_is_active and exists(select 1 from public.officer_invites invitation join auth.users auth_user on auth_user.id=invitation.auth_user_id where invitation.auth_user_id=p_user_id and invitation.status='sent' and auth_user.email_confirmed_at is null) then
    raise exception using errcode='CCO03',message='Use invitation cancellation for an unaccepted officer invite.';
  end if;
  if not p_is_active and v_target.role='Admin' and not exists(
    select 1 from public.users profile join auth.users auth_user on auth_user.id=profile.id
    where profile.role='Admin' and profile.is_active and profile.anonymized_at is null
      and profile.id<>p_user_id and auth_user.email_confirmed_at is not null
  ) then raise exception using errcode='CCO05',message='At least one other active confirmed Admin is required.';end if;
  v_caps:=public.officer_caps_are_enabled();
  if p_is_active and v_caps then
    if v_target.role='Admin' then
      select count(*) into v_active from public.users where role='Admin' and is_active;
      select count(*) into v_preparing from public.officer_invites where status='preparing' and created_at>now()-interval '15 minutes' and officer_role='Admin';
      if v_active+v_preparing>=2 then raise exception using errcode='CCO04',message='The Admin seats are currently full.';end if;
    else
      select count(*) into v_active from public.users where role='Co-Admin' and committee_id=v_target.committee_id and is_active;
      select count(*) into v_preparing from public.officer_invites where status='preparing' and created_at>now()-interval '15 minutes' and officer_role='Co-Admin' and committee_id=v_target.committee_id;
      if v_active+v_preparing>=1 then raise exception using errcode='CCO04',message='This committee officer seat is filled.';end if;
    end if;
  end if;
  perform set_config('ceit_connect.officer_writer','set_officer_active',true);
  update public.users set is_active=p_is_active,avatar_url=case when p_is_active then avatar_url else null end
  where id=p_user_id and role=v_target.role and anonymized_at is null;
  get diagnostics v_affected=row_count;
  perform set_config('ceit_connect.officer_writer','',true);
  if v_affected<>1 then raise exception using errcode='CCO06',message='Officer active state changed unexpectedly.';end if;
exception when others then
  perform set_config('ceit_connect.officer_writer','',true);raise;
end;
$$;
alter function public.set_officer_active(uuid,boolean) owner to postgres;
revoke all on function public.set_officer_active(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_officer_active(uuid,boolean) to authenticated;

create or replace function public.anonymize_former_member(p_user_id uuid)
returns table(out_user_id uuid,out_outcome text,out_reason_code text,out_email text,out_anonymized_at timestamptz)
language plpgsql volatile security definer set search_path=''
as $$
declare v_target public.users%rowtype;v_eligibility record;v_now timestamptz;v_affected integer;
begin
  perform public.officer_require_active_admin();
  if p_user_id is null then raise exception using errcode='CMR02',message='A target user ID is required.';end if;
  if p_user_id=auth.uid() then raise exception using errcode='CMR02',message='Admins cannot remove themselves.';end if;
  perform pg_catalog.pg_advisory_xact_lock(public.officer_advisory_lock_key());
  perform public.officer_require_active_admin();
  perform public.lock_task_assignee_users(array[p_user_id]::uuid[]);
  select * into v_target from public.users where id=p_user_id for update;
  if not found then raise exception using errcode='CMR03',message='The target profile is unavailable.';end if;
  select * into v_eligibility from public.former_member_eligibility(p_user_id);
  out_user_id:=p_user_id;
  if v_eligibility.out_outcome='already_anonymized' then
    out_outcome:='already_anonymized';out_reason_code:='already_anonymized';out_email:=v_eligibility.out_email;out_anonymized_at:=v_eligibility.out_anonymized_at;return next;return;
  end if;
  if v_eligibility.out_outcome<>'eligible' then
    out_outcome:='skipped';out_reason_code:=v_eligibility.out_reason_code;out_email:=v_eligibility.out_email;out_anonymized_at:=v_eligibility.out_anonymized_at;return next;return;
  end if;
  v_now:=clock_timestamp();
  begin
    perform set_config('ceit_connect.former_member_writer','anonymize_former_member',true);
    update public.users profile set email=profile.id::text||'@former.invalid',full_name='Former member',avatar_url=null,discord_id=null,is_active=false,anonymized_at=v_now
    where profile.id=p_user_id and profile.anonymized_at is null and profile.is_active is false
      and not exists(select 1 from public.tasks task_row join public.events event_row on event_row.id=task_row.event_id where task_row.status in ('To Do','In Progress') and event_row.status in ('Draft','Active') and (profile.id=any(task_row.primary_assignees) or profile.id=any(task_row.assist_assignees)));
    get diagnostics v_affected=row_count;
    perform set_config('ceit_connect.former_member_writer','',true);
  exception when others then
    perform set_config('ceit_connect.former_member_writer','',true);
    raise exception using errcode='CMR05',message='Anonymization failed before its invariant could be verified.';
  end;
  if v_affected<>1 then raise exception using errcode='CMR05',message='Anonymization could not be completed safely.';end if;
  select * into v_target from public.users where id=p_user_id;
  if v_target.role is distinct from v_eligibility.out_role or v_target.anonymized_at is distinct from v_now or v_target.is_active is not false or v_target.full_name<>'Former member' or v_target.email<>p_user_id::text||'@former.invalid' or v_target.avatar_url is not null or v_target.discord_id is not null then
    raise exception using errcode='CMR05',message='The anonymized profile invariant was not preserved.';
  end if;
  out_outcome:='anonymized';out_reason_code:='anonymized';out_email:=v_target.email;out_anonymized_at:=v_target.anonymized_at;return next;
exception when others then perform set_config('ceit_connect.former_member_writer','',true);raise;
end;
$$;
alter function public.anonymize_former_member(uuid) owner to postgres;
revoke all on function public.anonymize_former_member(uuid) from public,anon,authenticated;
grant execute on function public.anonymize_former_member(uuid) to authenticated;

create function public.get_admin_lifecycle_context()
returns table(confirmed_active_admin_count integer,caps_enabled boolean,active_admin_count integer,preparing_admin_count integer)
language plpgsql stable security definer set search_path=''
as $$
begin
  perform public.officer_require_active_admin();
  return query select
    (select count(*)::integer from public.users profile join auth.users auth_user on auth_user.id=profile.id where profile.role='Admin' and profile.is_active and profile.anonymized_at is null and auth_user.email_confirmed_at is not null),
    public.officer_caps_are_enabled(),
    (select count(*)::integer from public.users where role='Admin' and is_active and anonymized_at is null),
    (select count(*)::integer from public.officer_invites where status='preparing' and created_at>now()-interval '15 minutes' and officer_role='Admin');
end;
$$;
alter function public.get_admin_lifecycle_context() owner to postgres;
revoke all on function public.get_admin_lifecycle_context() from public,anon,authenticated;
grant execute on function public.get_admin_lifecycle_context() to authenticated;

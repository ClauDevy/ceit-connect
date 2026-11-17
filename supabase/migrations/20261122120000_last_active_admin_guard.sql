-- Preserve at least one confirmed, active, non-anonymized Admin for every
-- public.users writer. The statement trigger takes the established officer
-- advisory lock before UPDATE can lock any target users row. The AFTER row
-- trigger then evaluates the statement's resulting rows without creating the
-- officer-lock -> users-row inversion used by approved officer writers.

create function public.lock_last_active_admin_updates()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('transaction_isolation') is distinct from 'read committed' then
    raise exception using
      errcode = 'CCG03',
      message = 'Admin changes require read committed isolation.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.officer_advisory_lock_key()
  );
  return null;
end;
$$;

alter function public.lock_last_active_admin_updates() owner to postgres;
revoke all on function public.lock_last_active_admin_updates()
from public, anon, authenticated, service_role;

create trigger users_lock_last_active_admin_updates
before update of role, is_active, anonymized_at, committee_id
on public.users
for each statement execute function public.lock_last_active_admin_updates();

create function public.guard_last_active_admin()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if old.role is distinct from 'Admin'
     or old.is_active is not true
     or old.anonymized_at is not null
     or not exists (
       select 1
       from auth.users as auth_user
       where auth_user.id = old.id
         and auth_user.email_confirmed_at is not null
     ) then
    return null;
  end if;

  if new.role = 'Admin'
     and new.is_active
     and new.anonymized_at is null
     and exists (
       select 1
       from auth.users as auth_user
       where auth_user.id = new.id
         and auth_user.email_confirmed_at is not null
     ) then
    return null;
  end if;

  if not exists (
    select 1
    from public.users as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.role = 'Admin'
      and profile.is_active
      and profile.anonymized_at is null
      and auth_user.email_confirmed_at is not null
  ) then
    raise exception using
      errcode = 'CCG02',
      message = 'At least one active Admin is required.';
  end if;

  return null;
end;
$$;

alter function public.guard_last_active_admin() owner to postgres;
revoke all on function public.guard_last_active_admin()
from public, anon, authenticated, service_role;

create trigger users_guard_last_active_admin
after update of role, is_active, anonymized_at, committee_id
on public.users
for each row
when (
  old.role = 'Admin'
  and old.is_active
  and old.anonymized_at is null
  and (
    new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.anonymized_at is distinct from old.anonymized_at
  )
)
execute function public.guard_last_active_admin();

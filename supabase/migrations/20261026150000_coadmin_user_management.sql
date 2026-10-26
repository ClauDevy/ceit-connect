-- Batch 9: give active Co-Admins a narrow own-committee Member-management
-- boundary without restoring direct authenticated writes on public.users.

create function public.list_managed_users(
  p_is_active boolean,
  p_search text default null,
  p_offset integer default 0
)
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  committee_id uuid,
  avatar_url text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_search text := pg_catalog.btrim(p_search);
begin
  select profile.* into v_caller
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active
    and profile.role in ('Admin', 'Co-Admin');

  if not found
     or (v_caller.role = 'Co-Admin' and v_caller.committee_id is null) then
    return;
  end if;

  if p_is_active is null
     or p_offset is null
     or p_offset < 0
     or p_offset > 10000
     or p_offset % 20 <> 0
     or pg_catalog.char_length(v_search) > 100 then
    raise exception using
      errcode = 'CCM02',
      message = 'The users query is invalid.';
  end if;

  return query
  select profile.id,
         profile.full_name,
         profile.email,
         profile.role,
         profile.committee_id,
         profile.avatar_url,
         profile.is_active
  from public.users as profile
  left join public.committees as committee
    on committee.id = profile.committee_id
  where profile.is_active = p_is_active
    and (
      v_caller.role = 'Admin'
      or (
        profile.role = 'Member'
        and profile.committee_id = v_caller.committee_id
      )
    )
    and (
      v_search is null
      or v_search = ''
      or pg_catalog.strpos(
        pg_catalog.lower(profile.full_name), pg_catalog.lower(v_search)
      ) > 0
      or pg_catalog.strpos(
        pg_catalog.lower(profile.email), pg_catalog.lower(v_search)
      ) > 0
      or pg_catalog.strpos(
        pg_catalog.lower(profile.role), pg_catalog.lower(v_search)
      ) > 0
      or pg_catalog.strpos(
        pg_catalog.lower(coalesce(committee.name, '')),
        pg_catalog.lower(v_search)
      ) > 0
    )
  order by profile.full_name, profile.id
  limit 21
  offset p_offset;
end;
$$;

create function public.finalize_member_invite(
  p_auth_user_id uuid,
  p_email text,
  p_full_name text,
  p_committee_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller public.users%rowtype;
  v_email text;
  v_full_name text;
  v_committee_id uuid;
  v_auth_email text;
  v_auth_email_confirmed_at timestamptz;
  v_auth_last_sign_in_at timestamptz;
  v_auth_invited_at timestamptz;
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
  select profile.* into v_caller
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active
    and profile.role in ('Admin', 'Co-Admin');

  if not found
     or (v_caller.role = 'Co-Admin' and v_caller.committee_id is null) then
    raise exception using
      errcode = 'CCM01',
      message = 'Only an active Admin or Co-Admin can finalize a Member invitation.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    public.officer_advisory_lock_key()
  );

  select profile.* into v_caller
  from public.users as profile
  where profile.id = auth.uid()
    and profile.is_active
    and profile.role in ('Admin', 'Co-Admin');

  if not found
     or (v_caller.role = 'Co-Admin' and v_caller.committee_id is null) then
    raise exception using
      errcode = 'CCM01',
      message = 'Only an active Admin or Co-Admin can finalize a Member invitation.';
  end if;

  v_email := pg_catalog.lower(pg_catalog.btrim(p_email));

  if p_auth_user_id is null
     or v_email is null
     or v_email = ''
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or p_full_name is null
     or pg_catalog.char_length(p_full_name) > 1000 then
    raise exception using
      errcode = 'CCM02',
      message = 'The Member invitation details are invalid.';
  end if;

  if exists (
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

  if v_caller.role = 'Admin' then
    if p_committee_id is null or not exists (
      select 1 from public.committees as committee
      where committee.id = p_committee_id
    ) then
      raise exception using
        errcode = 'CCM08',
        message = 'The selected Member committee is invalid.';
    end if;
    v_committee_id := p_committee_id;
  else
    if p_committee_id is not null then
      raise exception using
        errcode = 'CCM02',
        message = 'Co-Admin invitations cannot supply committee authority.';
    end if;
    v_committee_id := v_caller.committee_id;
  end if;

  select pg_catalog.lower(pg_catalog.btrim(auth_user.email)),
         auth_user.email_confirmed_at,
         auth_user.last_sign_in_at,
         auth_user.invited_at
  into v_auth_email,
       v_auth_email_confirmed_at,
       v_auth_last_sign_in_at,
       v_auth_invited_at
  from auth.users as auth_user
  where auth_user.id = p_auth_user_id;

  if not found
     or v_auth_email is distinct from v_email
     or v_auth_email_confirmed_at is not null
     or v_auth_last_sign_in_at is not null
     or v_auth_invited_at is null then
    raise exception using
      errcode = 'CCM06',
      message = 'The Auth invitation is unavailable or does not match.';
  end if;

  if exists (
    select 1
    from public.officer_invites as invitation
    where invitation.status in ('preparing', 'sent', 'cleanup_pending')
      and (
        invitation.email = v_email
        or invitation.auth_user_id = p_auth_user_id
      )
  ) then
    raise exception using
      errcode = 'CCM07',
      message = 'An officer invitation already exists for this account.';
  end if;

  if exists (
    select 1 from public.users as profile
    where profile.id = p_auth_user_id
       or pg_catalog.lower(pg_catalog.btrim(profile.email)) = v_email
  ) then
    raise exception using
      errcode = 'CCM07',
      message = 'A profile already exists for this invitation.';
  end if;

  insert into public.users (
    id, email, full_name, role, committee_id, is_active
  ) values (
    p_auth_user_id, v_email, v_full_name, 'Member', v_committee_id, true
  );

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCM09',
      message = 'Member invitation finalization changed unexpectedly.';
  end if;

  return p_auth_user_id;
end;
$$;

create function public.deactivate_committee_member(p_user_id uuid)
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

  if not v_target.is_active then
    raise exception using
      errcode = 'CCM04',
      message = 'The selected Member state has changed.';
  end if;

  update public.users
  set is_active = false
  where id = p_user_id
    and role = 'Member'
    and committee_id = v_caller_committee_id
    and is_active;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCM09',
      message = 'Member deactivation changed unexpectedly.';
  end if;
end;
$$;

create function public.reactivate_committee_member(p_user_id uuid)
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
    and not is_active;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCM09',
      message = 'Member reactivation changed unexpectedly.';
  end if;
end;
$$;

create function public.update_committee_member_full_name(
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
    and committee_id = v_caller_committee_id;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCM09',
      message = 'Member name update changed unexpectedly.';
  end if;

  return v_full_name;
end;
$$;

alter function public.list_managed_users(boolean,text,integer) owner to postgres;
alter function public.finalize_member_invite(uuid,text,text,uuid) owner to postgres;
alter function public.deactivate_committee_member(uuid) owner to postgres;
alter function public.reactivate_committee_member(uuid) owner to postgres;
alter function public.update_committee_member_full_name(uuid,text) owner to postgres;

revoke all on function public.list_managed_users(boolean,text,integer)
from public, anon, authenticated;
revoke all on function public.finalize_member_invite(uuid,text,text,uuid)
from public, anon, authenticated;
revoke all on function public.deactivate_committee_member(uuid)
from public, anon, authenticated;
revoke all on function public.reactivate_committee_member(uuid)
from public, anon, authenticated;
revoke all on function public.update_committee_member_full_name(uuid,text)
from public, anon, authenticated;

grant execute on function public.list_managed_users(boolean,text,integer)
to authenticated;
grant execute on function public.finalize_member_invite(uuid,text,text,uuid)
to authenticated;
grant execute on function public.deactivate_committee_member(uuid)
to authenticated;
grant execute on function public.reactivate_committee_member(uuid)
to authenticated;
grant execute on function public.update_committee_member_full_name(uuid,text)
to authenticated;

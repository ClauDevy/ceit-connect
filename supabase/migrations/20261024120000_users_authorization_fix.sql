-- Batch 0: remove broad direct users UPDATE access and replace own-name edits
-- with one caller-derived, fixed-column writer.

drop policy "co_admin_update_own_committee_members" on public.users;

revoke update on table public.users from public;
revoke update on table public.users from anon;
revoke update on table public.users from authenticated;

create function public.update_own_profile(p_full_name text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller_id uuid := auth.uid();
  v_full_name text;
  v_affected integer;
  -- Explicitly shared with src/lib/profile.ts. Controls and U+2028/U+2029
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
  -- Authorization comes first so invalid input never reveals account state.
  if v_caller_id is null or not exists (
    select 1
    from public.users as caller
    where caller.id = v_caller_id
      and caller.is_active
  ) then
    raise exception using
      errcode = 'CCP01',
      message = 'Your profile is unavailable.';
  end if;

  if p_full_name is null
     or pg_catalog.char_length(p_full_name) > 1000 then
    raise exception using
      errcode = 'CCP02',
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
      errcode = 'CCP02',
      message = 'Full name must be 1 to 100 characters and cannot contain control characters or line breaks.';
  end if;

  v_full_name := pg_catalog.btrim(p_full_name, v_trim_chars);

  if pg_catalog.char_length(v_full_name) not between 1 and 100 then
    raise exception using
      errcode = 'CCP02',
      message = 'Full name must be 1 to 100 characters and cannot contain control characters or line breaks.';
  end if;

  update public.users
  set full_name = v_full_name
  where id = v_caller_id
    and is_active;

  get diagnostics v_affected = row_count;
  if v_affected <> 1 then
    raise exception using
      errcode = 'CCP01',
      message = 'Your profile is unavailable.';
  end if;

  return v_full_name;
end;
$$;

alter function public.update_own_profile(text) owner to postgres;

revoke all on function public.update_own_profile(text)
from public, anon, authenticated;
grant execute on function public.update_own_profile(text)
to authenticated;

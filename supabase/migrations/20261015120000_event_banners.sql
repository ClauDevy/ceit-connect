-- Phase 3 Step 7: public event banners with event-scoped writes.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'banners',
  'banners',
  true,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Storage object names must be <event-id>/<random-uuid>.webp. The event
-- update policy currently permits every active Admin and Co-Admin to edit
-- every Draft or Active event, so banner writes intentionally mirror that.
create function public.can_write_event_banner_object(p_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_event_id uuid;
begin
  if p_name is null or p_name !~* (
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/' ||
    '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$'
  ) then
    return false;
  end if;

  v_event_id := split_part(p_name, '/', 1)::uuid;

  return exists (
    select 1
    from public.events e
    join public.users u on u.id = auth.uid()
    where e.id = v_event_id
      and e.status in ('Draft', 'Active')
      and u.is_active = true
      and u.role in ('Admin', 'Co-Admin')
  );
exception
  when others then
    return false;
end;
$$;

revoke all on function public.can_write_event_banner_object(text)
from public, anon;
grant execute on function public.can_write_event_banner_object(text)
to authenticated;

create policy "Active users can read banners"
on storage.objects for select
to authenticated
using (bucket_id = 'banners');

create policy "Event editors can upload banners"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'banners'
  and public.can_write_event_banner_object(name)
);

create policy "Event editors can replace banners"
on storage.objects for update
to authenticated
using (
  bucket_id = 'banners'
  and public.can_write_event_banner_object(name)
)
with check (
  bucket_id = 'banners'
  and public.can_write_event_banner_object(name)
);

create policy "Event editors can delete banners"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'banners'
  and public.can_write_event_banner_object(name)
);

-- Validate both the environment-independent public URL shape and the matching
-- object row. The exception handler makes malformed input and lookup failures
-- fail closed.
create function public.event_banner_url_is_valid(
  p_event_id uuid,
  p_banner_url text
)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_file_name text;
  v_object_name text;
begin
  if p_banner_url is null then
    return true;
  end if;

  v_file_name := substring(
    p_banner_url
    from (
      '^https://[^./?#]+\.supabase\.co/storage/v1/object/public/banners/' ||
      p_event_id::text ||
      '/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp)$'
    )
  );

  if v_file_name is null then
    return false;
  end if;

  v_object_name := p_event_id::text || '/' || v_file_name;

  return exists (
    select 1
    from storage.objects o
    where o.bucket_id = 'banners'
      and o.name = v_object_name
  );
exception
  when others then
    return false;
end;
$$;

revoke all on function public.event_banner_url_is_valid(uuid, text)
from public, anon, authenticated;

create function public.guard_event_banner_url()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.event_banner_url_is_valid(new.id, new.banner_url) then
    raise exception 'Invalid event banner URL.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_event_banner_url()
from public, anon, authenticated;

create trigger events_guard_banner_url
before insert or update of banner_url on public.events
for each row
execute function public.guard_event_banner_url();

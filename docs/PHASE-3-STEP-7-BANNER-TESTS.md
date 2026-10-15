# Phase 3 Step 7 — banner tests

Run the migration first using the owner's normal rollout process. Do not run these
tests on production. The SQL blocks assume the standard Dev identities exist:

- Admin: `11111111-1111-1111-1111-111111111111`
- Co-Admin: `22222222-2222-2222-2222-222222222222`
- Member: `33333333-3333-3333-3333-333333333333`

Every SQL block is independent, creates its event as Active before archiving it,
impersonates all three roles, tests inserts/updates directly against
`storage.objects`, and ends in `rollback`. Supabase blocks direct deletion from
Storage tables in the SQL Editor, so delete authorization is tested through the
same helper used by the delete policy. Real object deletion is covered by the
replace/remove browser tests.

## Browser tests

1. Sign in as an Admin and open Create Event. Choose a JPEG/PNG/WebP photo larger
   than 4 MB but smaller than 20 MB. Confirm the 16:9 crop dialog opens, zoom and
   reposition it, and confirm the preview appears after processing.
2. Remove the pending preview and confirm no event or Storage object has been
   created. Choose and crop it again, save a Draft, and confirm Home displays the
   banner.
3. Create another event from an Archive Template. Confirm its banner starts empty
   even when the source archive has one.
4. On Create Event, prepare a banner and temporarily make the upload fail after
   saving (for example, use browser DevTools to block the `/api/event-banner`
   request). Confirm the event still exists and Edit Event shows the banner retry
   warning.
5. Open a Draft or Active event as an Admin. Change its name without saving, then
   upload a banner. Confirm the unsaved name remains in the form. Save Changes and
   confirm it succeeds rather than reporting a stale version.
6. Replace the banner. Confirm the new image appears on Home and the old object is
   removed from Storage only after the event row points to the new URL. Remove the
   banner and confirm the fallback returns everywhere.
7. Repeat upload, replace, and remove as a Co-Admin on an event created by someone
   else. All operations should succeed because Co-Admins may edit every Draft and
   Active event.
8. Open the same event in two browsers. Save a form or banner change in browser A,
   then attempt a banner change in browser B. Confirm browser B says exactly:
   `This event changed since you opened it. Reload to continue.` Confirm browser
   B's unsaved form fields remain visible.
9. Sign in as a Member. Confirm there are no banner controls. Attempt POST and
   DELETE requests to `/api/event-banner`; both must return 403.
10. As an Admin, archive an Active event with a banner. Confirm Home no longer
    shows it, `/archives` and `/archives/<event-id>` keep displaying its banner,
    and no upload/remove controls appear. Direct route attempts must fail.
11. Test light/dark mode and mobile width on Create, Edit, Home, Archives, and the
    Archived detail page. Confirm the crop dialog remains usable and failed/missing
    images show the semantic fallback.

## SQL test 1 — Active-event policies mirror `events_update`

```sql
begin;

insert into public.events (
  id, name, start_date, end_date, status, created_by
) values (
  'b7100000-0000-4000-8000-000000000001',
  'Step 7 active policy test',
  '2026-11-01',
  '2026-11-02',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

-- The delete policy must delegate its authorization decision to the same
-- fail-closed helper exercised below.
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Event editors can delete banners'
      and cmd = 'DELETE'
      and qual like '%can_write_event_banner_object(name)%'
  ) then
    raise exception 'Banner delete policy is missing or does not reference can_write_event_banner_object(name)';
  end if;
end
$$;

-- Active Admin: insert/update are allowed and the delete helper returns true.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated'
  )::text,
  true
);

insert into storage.objects (bucket_id, name, metadata)
values (
  'banners',
  'b7100000-0000-4000-8000-000000000001/b7111111-1111-4111-8111-111111111111.webp',
  '{"mimetype":"image/webp"}'::jsonb
);

do $$
declare v_rows integer;
begin
  update storage.objects
  set metadata = '{"mimetype":"image/webp","tested_by":"Admin"}'::jsonb
  where bucket_id = 'banners'
    and name = 'b7100000-0000-4000-8000-000000000001/b7111111-1111-4111-8111-111111111111.webp';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Admin update policy failed'; end if;

  if not public.can_write_event_banner_object(
    'b7100000-0000-4000-8000-000000000001/b7111111-1111-4111-8111-111111111111.webp'
  ) then
    raise exception 'Admin delete helper unexpectedly returned false';
  end if;
end
$$;

-- Active Co-Admin: insert/update are allowed and the delete helper returns
-- true, even though the event was created by the Admin and has no committee
-- ownership condition.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '22222222-2222-2222-2222-222222222222',
    'role', 'authenticated'
  )::text,
  true
);

insert into storage.objects (bucket_id, name, metadata)
values (
  'banners',
  'b7100000-0000-4000-8000-000000000001/b7222222-2222-4222-8222-222222222221.webp',
  '{"mimetype":"image/webp"}'::jsonb
);

do $$
declare v_rows integer;
begin
  update storage.objects
  set metadata = '{"mimetype":"image/webp","tested_by":"Co-Admin"}'::jsonb
  where bucket_id = 'banners'
    and name = 'b7100000-0000-4000-8000-000000000001/b7222222-2222-4222-8222-222222222221.webp';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then raise exception 'Co-Admin update policy failed'; end if;

  if not public.can_write_event_banner_object(
    'b7100000-0000-4000-8000-000000000001/b7222222-2222-4222-8222-222222222221.webp'
  ) then
    raise exception 'Co-Admin delete helper unexpectedly returned false';
  end if;
end
$$;

-- Member: insert is rejected, update affects zero rows, and the delete helper
-- returns false.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '33333333-3333-3333-3333-333333333333',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_rows integer;
  v_insert_rejected boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values (
      'banners',
      'b7100000-0000-4000-8000-000000000001/b7333333-3333-4333-8333-333333333333.webp',
      '{"mimetype":"image/webp"}'::jsonb
    );
  exception when insufficient_privilege then
    v_insert_rejected := true;
  end;
  if not v_insert_rejected then raise exception 'Member insert unexpectedly succeeded'; end if;

  update storage.objects
  set metadata = '{"mimetype":"image/webp","tested_by":"Member"}'::jsonb
  where bucket_id = 'banners'
    and name = 'b7100000-0000-4000-8000-000000000001/b7111111-1111-4111-8111-111111111111.webp';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Member update unexpectedly succeeded'; end if;

  if public.can_write_event_banner_object(
    'b7100000-0000-4000-8000-000000000001/b7111111-1111-4111-8111-111111111111.webp'
  ) then
    raise exception 'Member delete helper unexpectedly returned true';
  end if;
end
$$;

-- Every fixture event is archived through the real Active-to-Archived path.
reset role;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated'
  )::text,
  true
);
update public.events
set status = 'Archived'
where id = 'b7100000-0000-4000-8000-000000000001';

rollback;
```

## SQL test 2 — Archived events freeze all Storage write policies

```sql
begin;

insert into public.events (
  id, name, start_date, end_date, status, created_by
) values (
  'b7200000-0000-4000-8000-000000000002',
  'Step 7 archived policy test',
  '2026-11-03',
  '2026-11-04',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '11111111-1111-1111-1111-111111111111',
    'role', 'authenticated'
  )::text,
  true
);

insert into storage.objects (bucket_id, name, metadata) values
  ('banners', 'b7200000-0000-4000-8000-000000000002/b7211111-1111-4111-8111-111111111111.webp', '{"mimetype":"image/webp"}'::jsonb),
  ('banners', 'b7200000-0000-4000-8000-000000000002/b7222222-2222-4222-8222-222222222222.webp', '{"mimetype":"image/webp"}'::jsonb),
  ('banners', 'b7200000-0000-4000-8000-000000000002/b7233333-3333-4333-8333-333333333333.webp', '{"mimetype":"image/webp"}'::jsonb);

update public.events
set status = 'Archived'
where id = 'b7200000-0000-4000-8000-000000000002';

-- Run the same direct insert/update probes as each role. Insert must raise an
-- RLS error, update must affect zero rows, and the delete helper must return
-- false for the Archived event.
do $$
declare
  v_rows integer;
  v_insert_rejected boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('banners', 'b7200000-0000-4000-8000-000000000002/b7211111-1111-4111-8111-111111111119.webp', '{}'::jsonb);
  exception when insufficient_privilege then v_insert_rejected := true;
  end;
  if not v_insert_rejected then raise exception 'Archived Admin insert unexpectedly succeeded'; end if;
  update storage.objects set metadata = '{"blocked":true}'::jsonb
   where bucket_id = 'banners' and name = 'b7200000-0000-4000-8000-000000000002/b7211111-1111-4111-8111-111111111111.webp';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Archived Admin update unexpectedly succeeded'; end if;
  if public.can_write_event_banner_object(
    'b7200000-0000-4000-8000-000000000002/b7211111-1111-4111-8111-111111111111.webp'
  ) then
    raise exception 'Archived Admin delete helper unexpectedly returned true';
  end if;
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
do $$
declare v_rows integer; v_insert_rejected boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('banners', 'b7200000-0000-4000-8000-000000000002/b7222222-2222-4222-8222-222222222229.webp', '{}'::jsonb);
  exception when insufficient_privilege then v_insert_rejected := true;
  end;
  if not v_insert_rejected then raise exception 'Archived Co-Admin insert unexpectedly succeeded'; end if;
  update storage.objects set metadata = '{"blocked":true}'::jsonb
   where bucket_id = 'banners' and name = 'b7200000-0000-4000-8000-000000000002/b7222222-2222-4222-8222-222222222222.webp';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Archived Co-Admin update unexpectedly succeeded'; end if;
  if public.can_write_event_banner_object(
    'b7200000-0000-4000-8000-000000000002/b7222222-2222-4222-8222-222222222222.webp'
  ) then
    raise exception 'Archived Co-Admin delete helper unexpectedly returned true';
  end if;
end
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);
do $$
declare v_rows integer; v_insert_rejected boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('banners', 'b7200000-0000-4000-8000-000000000002/b7233333-3333-4333-8333-333333333339.webp', '{}'::jsonb);
  exception when insufficient_privilege then v_insert_rejected := true;
  end;
  if not v_insert_rejected then raise exception 'Archived Member insert unexpectedly succeeded'; end if;
  update storage.objects set metadata = '{"blocked":true}'::jsonb
   where bucket_id = 'banners' and name = 'b7200000-0000-4000-8000-000000000002/b7233333-3333-4333-8333-333333333333.webp';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Archived Member update unexpectedly succeeded'; end if;
  if public.can_write_event_banner_object(
    'b7200000-0000-4000-8000-000000000002/b7233333-3333-4333-8333-333333333333.webp'
  ) then
    raise exception 'Archived Member delete helper unexpectedly returned true';
  end if;
end
$$;

rollback;
```

## SQL test 3 — URL integrity, object existence, version bump, and template NULL

```sql
begin;

insert into public.events (
  id, name, start_date, end_date, status, created_by
) values (
  'b7300000-0000-4000-8000-000000000003',
  'Step 7 integrity test',
  '2026-11-05',
  '2026-11-06',
  'Active',
  '11111111-1111-1111-1111-111111111111'
);

select set_config(
  'step7.before_banner_version',
  updated_at::text,
  true
)
from public.events
where id = 'b7300000-0000-4000-8000-000000000003';

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);

insert into storage.objects (bucket_id, name, metadata) values
  ('banners', 'b7300000-0000-4000-8000-000000000003/b7311111-1111-4111-8111-111111111111.webp', '{"mimetype":"image/webp"}'::jsonb),
  ('banners', 'b7300000-0000-4000-8000-000000000003/b7322222-2222-4222-8222-222222222222.webp', '{"mimetype":"image/webp"}'::jsonb);

do $$
declare v_rejected boolean := false;
begin
  begin
    update public.events
    set banner_url = 'https://evil.example/banners/b7300000-0000-4000-8000-000000000003/b7311111-1111-4111-8111-111111111111.webp'
    where id = 'b7300000-0000-4000-8000-000000000003';
  exception when others then
    if sqlerrm = 'Invalid event banner URL.' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Non-Supabase URL unexpectedly succeeded'; end if;

  v_rejected := false;
  begin
    update public.events
    set banner_url = 'https://test-project.supabase.co/storage/v1/object/public/banners/b7300000-0000-4000-8000-000000000003/b7399999-9999-4999-8999-999999999999.webp'
    where id = 'b7300000-0000-4000-8000-000000000003';
  exception when others then
    if sqlerrm = 'Invalid event banner URL.' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Missing Storage object unexpectedly succeeded'; end if;
end
$$;

update public.events
set banner_url = 'https://test-project.supabase.co/storage/v1/object/public/banners/b7300000-0000-4000-8000-000000000003/b7311111-1111-4111-8111-111111111111.webp'
where id = 'b7300000-0000-4000-8000-000000000003';

do $$
begin
  if not exists (
    select 1 from public.events
    where id = 'b7300000-0000-4000-8000-000000000003'
      and banner_url like '%/b7311111-1111-4111-8111-111111111111.webp'
      and updated_at > current_setting('step7.before_banner_version')::timestamptz
  ) then
    raise exception 'Valid URL was not stored or updated_at did not advance';
  end if;
end
$$;

-- Co-Admin can select another existing object for the same Active event.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '22222222-2222-2222-2222-222222222222', 'role', 'authenticated')::text, true);
update storage.objects
set metadata = '{"mimetype":"image/webp","tested_by":"Co-Admin"}'::jsonb
where bucket_id = 'banners'
  and name = 'b7300000-0000-4000-8000-000000000003/b7322222-2222-4222-8222-222222222222.webp';
update public.events
set banner_url = 'https://test-project.supabase.co/storage/v1/object/public/banners/b7300000-0000-4000-8000-000000000003/b7322222-2222-4222-8222-222222222222.webp'
where id = 'b7300000-0000-4000-8000-000000000003';

-- Member cannot change the event row, even to NULL.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);
do $$
declare v_rows integer; v_insert_rejected boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, metadata)
    values ('banners', 'b7300000-0000-4000-8000-000000000003/b7333333-3333-4333-8333-333333333333.webp', '{}'::jsonb);
  exception when insufficient_privilege then v_insert_rejected := true;
  end;
  if not v_insert_rejected then raise exception 'Member Storage insert unexpectedly succeeded'; end if;

  update public.events
  set banner_url = null
  where id = 'b7300000-0000-4000-8000-000000000003';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Member banner update unexpectedly succeeded'; end if;
end
$$;

-- The normal creation RPC, used after archive-template import, does not accept
-- a banner and therefore creates NULL even though the template event has one.
reset role;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-1111-1111-111111111111', 'role', 'authenticated')::text, true);
select set_config(
  'step7.created_from_template_id',
  public.create_event_with_tasks(
    'Template-derived event',
    null,
    '2026-12-01',
    null,
    'Draft',
    '[]'::jsonb
  )::text,
  true
);

do $$
begin
  if not exists (
    select 1 from public.events
    where id = current_setting('step7.created_from_template_id')::uuid
      and banner_url is null
  ) then
    raise exception 'Template-derived event was missing or copied a banner';
  end if;
end
$$;

-- Archive through the real transition. RLS hides the Archived row from an
-- authenticated update, while the trigger also blocks a bypassing postgres
-- write, proving the freeze does not depend only on RLS.
update public.events
set status = 'Archived'
where id = 'b7300000-0000-4000-8000-000000000003';

do $$
declare v_rows integer;
begin
  update public.events
  set banner_url = null
  where id = 'b7300000-0000-4000-8000-000000000003';
  get diagnostics v_rows = row_count;
  if v_rows <> 0 then raise exception 'Archived Admin banner update unexpectedly succeeded'; end if;
end
$$;

reset role;
do $$
declare v_rejected boolean := false;
begin
  begin
    update public.events
    set banner_url = null
    where id = 'b7300000-0000-4000-8000-000000000003';
  exception when others then
    if sqlerrm = 'Archived events are read-only.' then v_rejected := true; else raise; end if;
  end;
  if not v_rejected then raise exception 'Archived trigger did not reject a bypassing banner update'; end if;
end
$$;

rollback;
```

## Delete-policy coverage

Supabase rejects direct `delete from storage.objects` statements in the SQL
Editor before they can serve as useful RLS probes. SQL tests 1 and 2 therefore
impersonate Admin, Co-Admin, and Member users and call
`public.can_write_event_banner_object(name)` directly. They verify that the
helper returns true only for Admins and Co-Admins on Draft/Active events, returns
false for Members and every role on Archived events, and that the
`Event editors can delete banners` policy references this helper.

Real Storage deletions are covered by browser tests 6, 7, 9, and 10 through the
app's authenticated replace/remove flow. Those tests verify successful deletion
for Admins and Co-Admins, rejection for Members and Archived events, and that a
failed database update does not delete the current banner.

# Phase 4 Step 4 — task work-link tests

**Run on DEV only. Choose Run without RLS in the pop-up.**

> **Obsolete after Phase 4B Batch 0:** the `USER_POLICIES_UNCHANGED`
> assertion includes `co_admin_update_own_committee_members` and the former
> four-policy count. Keep its historical result count unchanged; use
> `docs/phase-4b/step-0-tests.md` for the current `users` policy catalog.

Apply `20261017150000_task_work_links.sql` to Dev through the owner's normal
process before running these tests. Each numbered test is one self-contained
SQL Editor paste with its own Auth/profile/event/task fixtures and caller
impersonation. Every paste ends with an intentional
`raise exception 'TEST RESULTS ...'`, which rolls back the transaction.

No test creates a temporary table or touches `storage.objects`. Deferred
constraints are forced with `set constraints all immediate` before assertions.
Concurrency properties are checked through lock-bearing function bodies and
catalogs rather than a second SQL Editor session.

The application parser and database store the following pairs:

| Type | Parser `openUrl` | Database canonical pattern |
| --- | --- | --- |
| Drive file | `https://drive.google.com/file/d/<id>/view` | exact same form |
| Drive folder | `https://drive.google.com/drive/folders/<id>` | exact same form |
| Google Doc | `https://docs.google.com/document/d/<id>/edit` | exact same form |
| Google Sheet | `https://docs.google.com/spreadsheets/d/<id>/edit` | exact same form |
| Google Slides | `https://docs.google.com/presentation/d/<id>/edit` | exact same form |

Each form may end only with `?resourcekey=<key>`. IDs and resource keys use
`[A-Za-z0-9_-]` and are at most 200 characters. The Vitest parser suite reads
the migration's actual regex and proves every parser output matches it.

## TEST 1 — one-row reader, role matrix, Draft, Archived, and empty links

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44100000-0000-4000-8000-000000000001'::uuid, 's4-admin@test.local'),
  ('44100000-0000-4000-8000-000000000002'::uuid, 's4-own@test.local'),
  ('44100000-0000-4000-8000-000000000003'::uuid, 's4-other-co@test.local'),
  ('44100000-0000-4000-8000-000000000004'::uuid, 's4-primary@test.local'),
  ('44100000-0000-4000-8000-000000000005'::uuid, 's4-assist@test.local'),
  ('44100000-0000-4000-8000-000000000006'::uuid, 's4-viewer@test.local'),
  ('44100000-0000-4000-8000-000000000007'::uuid, 's4-member@test.local'),
  ('44100000-0000-4000-8000-000000000008'::uuid, 's4-inactive@test.local'),
  ('44100000-0000-4000-8000-000000000009'::uuid, 's4-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select id, email, full_name, role,
  case when committee_number = 0 then null else (
    select id from public.committees order by name
    offset committee_number - 1 limit 1
  ) end,
  is_active
from (values
  ('44100000-0000-4000-8000-000000000001'::uuid, 's4-admin@test.local', 'Admin', 'Admin', 0, true),
  ('44100000-0000-4000-8000-000000000002'::uuid, 's4-own@test.local', 'Owning Co', 'Co-Admin', 1, true),
  ('44100000-0000-4000-8000-000000000003'::uuid, 's4-other-co@test.local', 'Other Co', 'Co-Admin', 2, true),
  ('44100000-0000-4000-8000-000000000004'::uuid, 's4-primary@test.local', 'Primary', 'Member', 1, true),
  ('44100000-0000-4000-8000-000000000005'::uuid, 's4-assist@test.local', 'Assist', 'Member', 1, true),
  ('44100000-0000-4000-8000-000000000006'::uuid, 's4-viewer@test.local', 'Viewer', 'Member', 1, true),
  ('44100000-0000-4000-8000-000000000007'::uuid, 's4-member@test.local', 'Member', 'Member', 1, true),
  ('44100000-0000-4000-8000-000000000008'::uuid, 's4-inactive@test.local', 'Inactive', 'Member', 1, false)
) fixture(id, email, full_name, role, committee_number, is_active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('44110000-0000-4000-8000-000000000001', 'Work Active', '2026-12-01', '2026-12-02', 'Active', '44100000-0000-4000-8000-000000000001'),
  ('44110000-0000-4000-8000-000000000002', 'Work Draft', '2026-12-03', null, 'Draft', '44100000-0000-4000-8000-000000000001'),
  ('44110000-0000-4000-8000-000000000003', 'Work Archive', '2026-12-04', '2026-12-05', 'Active', '44100000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, is_confidential,
  primary_assignees, assist_assignees, allowed_viewers
)
select fixture.id, fixture.event_id, c.id, fixture.title, fixture.confidential,
  fixture.primary_ids, fixture.assist_ids, fixture.viewer_ids
from (values
  ('44120000-0000-4000-8000-000000000001'::uuid, '44110000-0000-4000-8000-000000000001'::uuid, 'Active secret', true,
   array['44100000-0000-4000-8000-000000000004'::uuid], array['44100000-0000-4000-8000-000000000005'::uuid], array['44100000-0000-4000-8000-000000000006'::uuid]),
  ('44120000-0000-4000-8000-000000000002'::uuid, '44110000-0000-4000-8000-000000000001'::uuid, 'Active empty public', false,
   '{}'::uuid[], '{}'::uuid[], '{}'::uuid[]),
  ('44120000-0000-4000-8000-000000000003'::uuid, '44110000-0000-4000-8000-000000000002'::uuid, 'Draft task', false,
   array['44100000-0000-4000-8000-000000000001'::uuid, '44100000-0000-4000-8000-000000000004'::uuid], '{}'::uuid[], '{}'::uuid[]),
  ('44120000-0000-4000-8000-000000000004'::uuid, '44110000-0000-4000-8000-000000000003'::uuid, 'Archive task', false,
   array['44100000-0000-4000-8000-000000000004'::uuid], '{}'::uuid[], '{}'::uuid[])
) fixture(id, event_id, title, confidential, primary_ids, assist_ids, viewer_ids)
cross join lateral (select id from public.committees order by name limit 1) c;

select set_config('request.jwt.claims',
  json_build_object('sub', '44100000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
select * from public.add_task_work_link(
  '44120000-0000-4000-8000-000000000001', 'Secret brief',
  'https://drive.google.com/file/d/ActiveSecret_ID/view');
select * from public.add_task_work_link(
  '44120000-0000-4000-8000-000000000004', 'Archive brief',
  'https://drive.google.com/file/d/Archive_ID/view');

select set_config('request.jwt.claims',
  json_build_object('sub', '44100000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select * from public.add_task_work_link(
  '44120000-0000-4000-8000-000000000003', 'Draft brief',
  'https://docs.google.com/document/d/DraftDoc_ID/edit');

update public.events set status = 'Archived'
where id = '44110000-0000-4000-8000-000000000003';

set constraints all immediate;
-- Stay as migration owner in this paste so the restricted access helper can be
-- compared directly. Caller identity still changes through JWT impersonation.

do $$
declare
  v_callers uuid[] := array[
    '44100000-0000-4000-8000-000000000001'::uuid,
    '44100000-0000-4000-8000-000000000002'::uuid,
    '44100000-0000-4000-8000-000000000003'::uuid,
    '44100000-0000-4000-8000-000000000004'::uuid,
    '44100000-0000-4000-8000-000000000005'::uuid,
    '44100000-0000-4000-8000-000000000006'::uuid,
    '44100000-0000-4000-8000-000000000007'::uuid,
    '44100000-0000-4000-8000-000000000008'::uuid,
    '44100000-0000-4000-8000-000000000009'::uuid
  ];
  v_caller uuid;
  v_index integer := 0;
  v_rows integer;
  v_count integer;
  v_can_add boolean;
  v_can_remove boolean;
  v_task uuid;
  v_access text;
  v_detail text;
  v_link_id uuid;
  v_failed boolean;
  v_ok boolean := true;
  v_results text := '';
begin
  foreach v_caller in array v_callers loop
    v_index := v_index + 1;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);

    select count(*) into v_rows
    from public.get_task_work_links('44120000-0000-4000-8000-000000000001');
    if v_index in (1, 2, 4, 5, 6) then
      v_ok := v_ok and v_rows = 1;
    else
      v_ok := v_ok and v_rows = 0;
    end if;

    select count(*) into v_rows
    from public.get_task_work_links('44120000-0000-4000-8000-000000000002');
    if v_index <= 7 then
      v_ok := v_ok and v_rows = 1;
    else
      v_ok := v_ok and v_rows = 0;
    end if;

    if v_index <= 7 then
      select jsonb_array_length(links), can_add
      into v_count, v_can_add
      from public.get_task_work_links('44120000-0000-4000-8000-000000000002');
      v_ok := v_ok and v_count = 0 and not v_can_add;
    end if;

    select count(*) into v_rows
    from public.get_task_work_links('44120000-0000-4000-8000-000000000003');
    v_ok := v_ok and v_rows = case when v_index in (1, 2) then 1 else 0 end;

    select count(*) into v_rows
    from public.get_task_work_links('44120000-0000-4000-8000-000000000004');
    if v_index <= 7 then
      v_ok := v_ok and v_rows = 1;
      select can_add, (links -> 0 ->> 'can_remove')::boolean
      into v_can_add, v_can_remove
      from public.get_task_work_links('44120000-0000-4000-8000-000000000004');
      v_ok := v_ok and not v_can_add and not v_can_remove;
    else
      v_ok := v_ok and v_rows = 0;
    end if;

    foreach v_task in array array[
      '44120000-0000-4000-8000-000000000001'::uuid,
      '44120000-0000-4000-8000-000000000002'::uuid,
      '44120000-0000-4000-8000-000000000003'::uuid,
      '44120000-0000-4000-8000-000000000004'::uuid
    ] loop
      v_access := public.task_content_access(v_task);
      select case when count(*) = 0 then 'hidden'
        when bool_or(is_masked) then 'masked' else 'real' end
      into v_detail from public.get_task_detail(v_task);
      select count(*) into v_rows from public.get_task_work_links(v_task);
      v_ok := v_ok
        and v_detail = v_access
        and v_rows = case when v_access = 'real' then 1 else 0 end;
    end loop;
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', '44100000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  select (links -> 0 ->> 'id')::uuid into v_link_id
  from public.get_task_work_links('44120000-0000-4000-8000-000000000003');
  perform public.remove_task_work_link(v_link_id);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '44100000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform * from public.add_task_work_link(
      '44120000-0000-4000-8000-000000000003', null,
      'https://drive.google.com/file/d/DraftMemberDenied/view');
  exception when insufficient_privilege then
    v_failed := true;
  end;
  v_ok := v_ok and v_failed;

  v_results := v_results || format(E'\nREAL_ONE_ROW_INCLUDING_EMPTY_MASKED_HIDDEN_ZERO: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nDRAFT_ADMIN_OWNING_CO_ONLY: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nARCHIVED_READABLE_WITH_NO_WRITE_FLAGS: %s', case when v_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nALL_FIXTURE_CALLERS_MATCH_HELPER_AND_DETAIL: %s', case when v_ok then 'PASS' else 'FAIL' end);
  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — add rights, derived creator, URLs, duplicate, and cap

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44200000-0000-4000-8000-000000000001'::uuid, 's4a-admin@test.local'),
  ('44200000-0000-4000-8000-000000000002'::uuid, 's4a-own@test.local'),
  ('44200000-0000-4000-8000-000000000003'::uuid, 's4a-other-co@test.local'),
  ('44200000-0000-4000-8000-000000000004'::uuid, 's4a-primary@test.local'),
  ('44200000-0000-4000-8000-000000000005'::uuid, 's4a-assist@test.local'),
  ('44200000-0000-4000-8000-000000000006'::uuid, 's4a-viewer@test.local'),
  ('44200000-0000-4000-8000-000000000007'::uuid, 's4a-member@test.local'),
  ('44200000-0000-4000-8000-000000000008'::uuid, 's4a-inactive@test.local'),
  ('44200000-0000-4000-8000-000000000009'::uuid, 's4a-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select id, email, full_name, role,
  case when committee_number = 0 then null else (
    select id from public.committees order by name offset committee_number - 1 limit 1
  ) end, is_active
from (values
  ('44200000-0000-4000-8000-000000000001'::uuid, 's4a-admin@test.local', 'Admin', 'Admin', 0, true),
  ('44200000-0000-4000-8000-000000000002'::uuid, 's4a-own@test.local', 'Owning Co', 'Co-Admin', 1, true),
  ('44200000-0000-4000-8000-000000000003'::uuid, 's4a-other-co@test.local', 'Other Co', 'Co-Admin', 2, true),
  ('44200000-0000-4000-8000-000000000004'::uuid, 's4a-primary@test.local', 'Primary', 'Member', 1, true),
  ('44200000-0000-4000-8000-000000000005'::uuid, 's4a-assist@test.local', 'Assist', 'Member', 1, true),
  ('44200000-0000-4000-8000-000000000006'::uuid, 's4a-viewer@test.local', 'Viewer', 'Member', 1, true),
  ('44200000-0000-4000-8000-000000000007'::uuid, 's4a-member@test.local', 'Member', 'Member', 1, true),
  ('44200000-0000-4000-8000-000000000008'::uuid, 's4a-inactive@test.local', 'Inactive', 'Member', 1, false)
) fixture(id, email, full_name, role, committee_number, is_active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('44210000-0000-4000-8000-000000000001', 'Add Event', '2026-12-06', '2026-12-07', 'Active', '44200000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, is_confidential,
  primary_assignees, assist_assignees, allowed_viewers
)
select fixture.id, '44210000-0000-4000-8000-000000000001', c.id,
  fixture.title, fixture.confidential,
  array['44200000-0000-4000-8000-000000000004'::uuid],
  array['44200000-0000-4000-8000-000000000005'::uuid],
  array['44200000-0000-4000-8000-000000000006'::uuid]
from (values
  ('44220000-0000-4000-8000-000000000001'::uuid, 'Add matrix', true),
  ('44220000-0000-4000-8000-000000000002'::uuid, 'Duplicate', false),
  ('44220000-0000-4000-8000-000000000003'::uuid, 'Cap', false),
  ('44220000-0000-4000-8000-000000000004'::uuid, 'Canonical types', false)
) fixture(id, title, confidential)
cross join lateral (select id from public.committees order by name limit 1) c;

set constraints all immediate;
set local role authenticated;

do $$
declare
  v_callers uuid[] := array[
    '44200000-0000-4000-8000-000000000001'::uuid,
    '44200000-0000-4000-8000-000000000002'::uuid,
    '44200000-0000-4000-8000-000000000003'::uuid,
    '44200000-0000-4000-8000-000000000004'::uuid,
    '44200000-0000-4000-8000-000000000005'::uuid,
    '44200000-0000-4000-8000-000000000006'::uuid,
    '44200000-0000-4000-8000-000000000007'::uuid,
    '44200000-0000-4000-8000-000000000008'::uuid,
    '44200000-0000-4000-8000-000000000009'::uuid
  ];
  v_caller uuid;
  v_index integer := 0;
  v_failed boolean;
  v_i integer;
  v_count integer;
  v_ok boolean := true;
  v_results text := '';
begin
  foreach v_caller in array v_callers loop
    v_index := v_index + 1;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);
    v_failed := false;
    begin
      perform * from public.add_task_work_link(
        '44220000-0000-4000-8000-000000000001', null,
        format('https://drive.google.com/file/d/Role_%s/view', v_index));
    exception when others then
      v_failed := true;
    end;
    v_ok := v_ok and v_failed = (v_index not in (4, 5));
  end loop;
  v_results := v_results || format(E'\nONLY_PRIMARY_AND_ASSIST_ADD: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims',
    json_build_object('sub', '44200000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);

  v_failed := false;
  begin
    insert into public.task_work_links (task_id, name, url, created_by)
    values (
      '44220000-0000-4000-8000-000000000002', 'Spoof test',
      'https://drive.google.com/file/d/Spoof_ID/view',
      '44200000-0000-4000-8000-000000000001'
    );
  exception when insufficient_privilege then
    v_failed := true;
  end;
  v_ok := v_ok and v_failed;
  v_results := v_results || format(E'\nRPC_HAS_NO_CREATOR_INPUT_AND_DIRECT_SPOOF_REJECTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  for v_i in 1..7 loop
    v_failed := false;
    begin
      perform * from public.add_task_work_link(
        '44220000-0000-4000-8000-000000000002', null,
        (array[
          'not a url',
          'https://evil.example/file/d/Bad/view',
          'http://drive.google.com/file/d/Bad/view',
          'javascript:alert(1)',
          'https://drive.google.com/open?id=NotCanonical',
          'https://drive.google.com/file/d/Bad/view?usp=sharing',
          'https://drive.google.com/file/d/' || repeat('a', 513) || '/view'
        ])[v_i]);
    exception when others then
      v_failed := true;
    end;
    v_ok := v_ok and v_failed;
  end loop;
  v_failed := false;
  begin
    perform * from public.add_task_work_link(
      '44220000-0000-4000-8000-000000000002', repeat('n', 121),
      'https://drive.google.com/file/d/NameTooLong_ID/view');
  exception when invalid_parameter_value then
    v_failed := true;
  end;
  v_ok := v_ok and v_failed;
  v_results := v_results || format(E'\nMALFORMED_HOST_HTTP_SCRIPT_NONCANONICAL_OVERLENGTH_REJECTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform * from public.add_task_work_link('44220000-0000-4000-8000-000000000004', 'File', 'https://drive.google.com/file/d/File_ID/view');
  perform * from public.add_task_work_link('44220000-0000-4000-8000-000000000004', 'Folder', 'https://drive.google.com/drive/folders/Folder_ID');
  perform * from public.add_task_work_link('44220000-0000-4000-8000-000000000004', 'Doc', 'https://docs.google.com/document/d/Doc_ID/edit');
  perform * from public.add_task_work_link('44220000-0000-4000-8000-000000000004', 'Sheet', 'https://docs.google.com/spreadsheets/d/Sheet_ID/edit');
  perform * from public.add_task_work_link('44220000-0000-4000-8000-000000000004', 'Slides', 'https://docs.google.com/presentation/d/Slides_ID/edit?resourcekey=key_123');
  select count(*) into v_count from public.get_task_work_links('44220000-0000-4000-8000-000000000004'), lateral jsonb_array_elements(links);
  v_ok := v_count = 5;
  v_results := v_results || format(E'\nALL_FIVE_CANONICAL_TYPES_ACCEPTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform * from public.add_task_work_link('44220000-0000-4000-8000-000000000002', null, 'https://drive.google.com/file/d/Duplicate_ID/view');
  v_failed := false;
  begin
    perform * from public.add_task_work_link('44220000-0000-4000-8000-000000000002', 'Again', 'https://drive.google.com/file/d/Duplicate_ID/view');
  exception when unique_violation then
    v_failed := true;
  end;
  v_ok := v_failed;
  v_results := v_results || format(E'\nDUPLICATE_DOUBLE_SUBMIT_REJECTED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  for v_i in 1..20 loop
    perform * from public.add_task_work_link(
      '44220000-0000-4000-8000-000000000003', null,
      format('https://drive.google.com/file/d/Cap_%s/view', v_i));
  end loop;
  v_failed := false;
  begin
    perform * from public.add_task_work_link(
      '44220000-0000-4000-8000-000000000003', null,
      'https://drive.google.com/file/d/Cap_21/view');
  exception when sqlstate 'CCL04' then
    v_failed := true;
  end;
  select jsonb_array_length(links) into v_count
  from public.get_task_work_links('44220000-0000-4000-8000-000000000003');
  v_ok := v_failed and v_count = 20;
  v_results := v_results || format(E'\nTWENTY_LINK_CAP_ENFORCED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — remove matrix and confidential Co-Admin boundary

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44300000-0000-4000-8000-000000000001'::uuid, 's4r-admin@test.local'),
  ('44300000-0000-4000-8000-000000000002'::uuid, 's4r-own@test.local'),
  ('44300000-0000-4000-8000-000000000003'::uuid, 's4r-other-co@test.local'),
  ('44300000-0000-4000-8000-000000000004'::uuid, 's4r-primary@test.local'),
  ('44300000-0000-4000-8000-000000000005'::uuid, 's4r-assist@test.local'),
  ('44300000-0000-4000-8000-000000000006'::uuid, 's4r-viewer@test.local'),
  ('44300000-0000-4000-8000-000000000007'::uuid, 's4r-member@test.local'),
  ('44300000-0000-4000-8000-000000000008'::uuid, 's4r-inactive@test.local'),
  ('44300000-0000-4000-8000-000000000009'::uuid, 's4r-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
select id, email, full_name, role,
  case when committee_number = 0 then null else (
    select id from public.committees order by name offset committee_number - 1 limit 1
  ) end, is_active
from (values
  ('44300000-0000-4000-8000-000000000001'::uuid, 's4r-admin@test.local', 'Admin', 'Admin', 0, true),
  ('44300000-0000-4000-8000-000000000002'::uuid, 's4r-own@test.local', 'Owning Co', 'Co-Admin', 1, true),
  ('44300000-0000-4000-8000-000000000003'::uuid, 's4r-other-co@test.local', 'Other Co', 'Co-Admin', 2, true),
  ('44300000-0000-4000-8000-000000000004'::uuid, 's4r-primary@test.local', 'Primary', 'Member', 1, true),
  ('44300000-0000-4000-8000-000000000005'::uuid, 's4r-assist@test.local', 'Assist', 'Member', 1, true),
  ('44300000-0000-4000-8000-000000000006'::uuid, 's4r-viewer@test.local', 'Viewer', 'Member', 1, true),
  ('44300000-0000-4000-8000-000000000007'::uuid, 's4r-member@test.local', 'Member', 'Member', 1, true),
  ('44300000-0000-4000-8000-000000000008'::uuid, 's4r-inactive@test.local', 'Inactive', 'Member', 1, false)
) fixture(id, email, full_name, role, committee_number, is_active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('44310000-0000-4000-8000-000000000001', 'Remove Event', '2026-12-08', '2026-12-09', 'Active', '44300000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, is_confidential,
  primary_assignees, assist_assignees, allowed_viewers
)
select fixture.id, '44310000-0000-4000-8000-000000000001', c.id,
  fixture.title, fixture.confidential,
  array['44300000-0000-4000-8000-000000000004'::uuid],
  array['44300000-0000-4000-8000-000000000005'::uuid],
  array['44300000-0000-4000-8000-000000000006'::uuid]
from (values
  ('44320000-0000-4000-8000-000000000001'::uuid, 'Secret remove', true),
  ('44320000-0000-4000-8000-000000000002'::uuid, 'Public remove', false)
) fixture(id, title, confidential)
cross join lateral (select id from public.committees order by name limit 1) c;

set constraints all immediate;
set local role authenticated;

do $$
declare
  v_link_id uuid;
  v_caller uuid;
  v_links uuid[] := '{}';
  v_actors uuid[] := array[
    '44300000-0000-4000-8000-000000000001'::uuid,
    '44300000-0000-4000-8000-000000000002'::uuid,
    '44300000-0000-4000-8000-000000000003'::uuid
  ];
  v_i integer;
  v_failed boolean;
  v_ok boolean := true;
  v_results text := '';
begin
  -- Creator succeeds.
  perform set_config('request.jwt.claims', json_build_object('sub', '44300000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
  select id into v_link_id from public.add_task_work_link('44320000-0000-4000-8000-000000000001', null, 'https://drive.google.com/file/d/CreatorRemove/view');
  perform public.remove_task_work_link(v_link_id);
  v_ok := not exists (select 1 from public.get_task_work_links('44320000-0000-4000-8000-000000000001'), lateral jsonb_array_elements(links) item where item ->> 'id' = v_link_id::text);
  v_results := v_results || format(E'\nCREATOR_REMOVE_SUCCEEDS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Admin, owning Co-Admin, and other Co-Admin on a public task succeed.
  for v_i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', '44300000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
    select id into v_link_id from public.add_task_work_link(
      '44320000-0000-4000-8000-000000000002', null,
      format('https://drive.google.com/file/d/Public_%s/view', v_i));
    v_links := array_append(v_links, v_link_id);
  end loop;

  for v_i in 1..3 loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_actors[v_i], 'role', 'authenticated')::text, true);
    perform public.remove_task_work_link(v_links[v_i]);
  end loop;
  v_results := v_results || E'\nADMIN_AND_REAL_CO_ADMINS_REMOVE: PASS';

  -- Other-committee Co-Admin is masked on the confidential task and fails.
  perform set_config('request.jwt.claims', json_build_object('sub', '44300000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
  select id into v_link_id from public.add_task_work_link('44320000-0000-4000-8000-000000000001', null, 'https://drive.google.com/file/d/SecretOtherCo/view');
  perform set_config('request.jwt.claims', json_build_object('sub', '44300000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
  v_failed := false;
  begin perform public.remove_task_work_link(v_link_id); exception when insufficient_privilege then v_failed := true; end;
  v_ok := v_failed;
  v_results := v_results || format(E'\nCO_ADMIN_WITHOUT_REAL_ACCESS_FAILS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Assist (non-creator), allowed viewer, unassigned, inactive, and profile-less fail.
  foreach v_caller in array array[
    '44300000-0000-4000-8000-000000000005'::uuid,
    '44300000-0000-4000-8000-000000000006'::uuid,
    '44300000-0000-4000-8000-000000000007'::uuid,
    '44300000-0000-4000-8000-000000000008'::uuid,
    '44300000-0000-4000-8000-000000000009'::uuid
  ] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_caller, 'role', 'authenticated')::text, true);
    v_failed := false;
    begin perform public.remove_task_work_link(v_link_id); exception when others then v_failed := true; end;
    v_ok := v_ok and v_failed;
  end loop;
  v_results := v_results || format(E'\nALL_OTHER_ROLES_FAIL_REMOVE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — Archived writes, immutable updates, profile deletion, and cascades

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44400000-0000-4000-8000-000000000001'::uuid, 's4g-admin@test.local'),
  ('44400000-0000-4000-8000-000000000002'::uuid, 's4g-member@test.local'),
  ('44400000-0000-4000-8000-000000000003'::uuid, 's4g-disposable@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('44400000-0000-4000-8000-000000000001', 's4g-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.name, 'Member', c.id, true
from (values
  ('44400000-0000-4000-8000-000000000002'::uuid, 's4g-member@test.local', 'Member'),
  ('44400000-0000-4000-8000-000000000003'::uuid, 's4g-disposable@test.local', 'Disposable')
) fixture(id, email, name)
cross join lateral (select id from public.committees order by name limit 1) c;

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('44410000-0000-4000-8000-000000000001', 'Cascade Draft', '2026-12-10', null, 'Draft', '44400000-0000-4000-8000-000000000001'),
  ('44410000-0000-4000-8000-000000000002', 'Archive Guard', '2026-12-11', '2026-12-12', 'Active', '44400000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title, primary_assignees)
select fixture.id, fixture.event_id, c.id, fixture.title, fixture.assignees
from (values
  ('44420000-0000-4000-8000-000000000001'::uuid, '44410000-0000-4000-8000-000000000001'::uuid, 'Cascade task', array['44400000-0000-4000-8000-000000000001'::uuid]),
  ('44420000-0000-4000-8000-000000000002'::uuid, '44410000-0000-4000-8000-000000000002'::uuid, 'Profile task', array['44400000-0000-4000-8000-000000000003'::uuid]),
  ('44420000-0000-4000-8000-000000000003'::uuid, '44410000-0000-4000-8000-000000000002'::uuid, 'Archived linked task', array['44400000-0000-4000-8000-000000000002'::uuid]),
  ('44420000-0000-4000-8000-000000000004'::uuid, '44410000-0000-4000-8000-000000000002'::uuid, 'Second active task', '{}'::uuid[])
) fixture(id, event_id, title, assignees)
cross join lateral (select id from public.committees order by name limit 1) c;

select set_config('request.jwt.claims', json_build_object('sub', '44400000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
select * from public.add_task_work_link('44420000-0000-4000-8000-000000000001', null, 'https://drive.google.com/file/d/Cascade_ID/view');
select set_config('request.jwt.claims', json_build_object('sub', '44400000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
select * from public.add_task_work_link('44420000-0000-4000-8000-000000000002', null, 'https://drive.google.com/file/d/Profile_ID/view');
select set_config('request.jwt.claims', json_build_object('sub', '44400000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
select * from public.add_task_work_link('44420000-0000-4000-8000-000000000003', null, 'https://drive.google.com/file/d/ArchiveGuard_ID/view');

delete from auth.users where id = '44400000-0000-4000-8000-000000000003';
update public.events set status = 'Archived' where id = '44410000-0000-4000-8000-000000000002';
set constraints all immediate;

do $$
declare
  v_archive_link uuid;
  v_failed boolean;
  v_ok boolean;
  v_results text := '';
begin
  select id into v_archive_link from public.task_work_links
  where task_id = '44420000-0000-4000-8000-000000000003';

  select created_by is null into v_ok from public.task_work_links
  where task_id = '44420000-0000-4000-8000-000000000002';
  v_results := v_results || format(E'\nCREATED_BY_VALUE_TO_NULL_FK_UPDATE_ALLOWED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin
    update public.task_work_links set name = 'Changed' where id = v_archive_link;
  exception when sqlstate 'CCL05' then v_failed := true;
  end;
  v_results := v_results || format(E'\nALL_OTHER_UPDATES_REJECTED: %s', case when v_failed then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin
    update public.task_work_links
    set task_id = '44420000-0000-4000-8000-000000000004'
    where id = v_archive_link;
  exception when sqlstate 'CCL05' then v_failed := true;
  end;
  v_results := v_results || format(E'\nTASK_ID_UPDATE_REJECTED: %s', case when v_failed then 'PASS' else 'FAIL' end);

  v_failed := false;
  begin delete from public.tasks where id = '44420000-0000-4000-8000-000000000003'; exception when others then v_failed := true; end;
  v_ok := v_failed
    and exists (select 1 from public.tasks where id = '44420000-0000-4000-8000-000000000003')
    and exists (select 1 from public.task_work_links where id = v_archive_link);
  v_results := v_results || format(E'\nARCHIVED_TASK_DELETE_BLOCKED_BEFORE_CASCADE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  delete from public.tasks where id = '44420000-0000-4000-8000-000000000001';
  v_ok := not exists (select 1 from public.task_work_links where task_id = '44420000-0000-4000-8000-000000000001');
  v_results := v_results || format(E'\nDRAFT_TASK_DELETE_CASCADES_LINKS_WHEN_TASK_ROW_IS_GONE: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — Archived RPC failures, revocation, and reader parity

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44500000-0000-4000-8000-000000000001'::uuid, 's4p-admin@test.local'),
  ('44500000-0000-4000-8000-000000000002'::uuid, 's4p-primary@test.local'),
  ('44500000-0000-4000-8000-000000000003'::uuid, 's4p-viewer@test.local'),
  ('44500000-0000-4000-8000-000000000004'::uuid, 's4p-member@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('44500000-0000-4000-8000-000000000001', 's4p-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.name, 'Member', c.id, true
from (values
  ('44500000-0000-4000-8000-000000000002'::uuid, 's4p-primary@test.local', 'Primary'),
  ('44500000-0000-4000-8000-000000000003'::uuid, 's4p-viewer@test.local', 'Viewer'),
  ('44500000-0000-4000-8000-000000000004'::uuid, 's4p-member@test.local', 'Member')
) fixture(id, email, name)
cross join lateral (select id from public.committees order by name limit 1) c;

insert into public.events (id, name, start_date, end_date, status, created_by)
values
  ('44510000-0000-4000-8000-000000000001', 'Revocation Active', '2026-12-13', '2026-12-14', 'Active', '44500000-0000-4000-8000-000000000001'),
  ('44510000-0000-4000-8000-000000000002', 'Immutable Archive', '2026-12-15', '2026-12-16', 'Active', '44500000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title, is_confidential, primary_assignees, allowed_viewers)
select fixture.id, fixture.event_id, c.id, fixture.title, fixture.confidential,
  fixture.assignees, fixture.viewers
from (values
  ('44520000-0000-4000-8000-000000000001'::uuid, '44510000-0000-4000-8000-000000000001'::uuid, 'Revocation secret', true, array['44500000-0000-4000-8000-000000000002'::uuid], array['44500000-0000-4000-8000-000000000003'::uuid]),
  ('44520000-0000-4000-8000-000000000002'::uuid, '44510000-0000-4000-8000-000000000002'::uuid, 'Archived public', false, array['44500000-0000-4000-8000-000000000002'::uuid], '{}'::uuid[]),
  ('44520000-0000-4000-8000-000000000003'::uuid, '44510000-0000-4000-8000-000000000002'::uuid, 'Second archive task', false, '{}'::uuid[], '{}'::uuid[])
) fixture(id, event_id, title, confidential, assignees, viewers)
cross join lateral (select id from public.committees order by name limit 1) c;

select set_config('request.jwt.claims', json_build_object('sub', '44500000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
select * from public.add_task_work_link('44520000-0000-4000-8000-000000000001', null, 'https://drive.google.com/file/d/Revoke_ID/view');
select * from public.add_task_work_link('44520000-0000-4000-8000-000000000002', null, 'https://drive.google.com/file/d/ArchivedRPC_ID/view');
update public.events set status = 'Archived' where id = '44510000-0000-4000-8000-000000000002';
set constraints all immediate;

do $$
declare
  v_link uuid;
  v_rows integer;
  v_detail text;
  v_access text;
  v_failed boolean;
  v_ok boolean := true;
  v_results text := '';
begin
  -- This paste stays migration-owner so it can inspect restricted task_content_access().
  foreach v_link in array array[
    '44500000-0000-4000-8000-000000000001'::uuid,
    '44500000-0000-4000-8000-000000000002'::uuid,
    '44500000-0000-4000-8000-000000000003'::uuid,
    '44500000-0000-4000-8000-000000000004'::uuid
  ] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_link, 'role', 'authenticated')::text, true);
    v_access := public.task_content_access('44520000-0000-4000-8000-000000000001');
    select case when count(*) = 0 then 'hidden' when bool_or(is_masked) then 'masked' else 'real' end
      into v_detail from public.get_task_detail('44520000-0000-4000-8000-000000000001');
    select count(*) into v_rows from public.get_task_work_links('44520000-0000-4000-8000-000000000001');
    v_ok := v_ok and v_detail = v_access and v_rows = case when v_access = 'real' then 1 else 0 end;
  end loop;
  v_results := v_results || format(E'\nCONTENT_DETAIL_LINK_READER_PARITY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  -- Remove both the assignee and allowed viewer, then prove next reads/writes fail.
  perform set_config('request.jwt.claims', json_build_object('sub', '44500000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  update public.tasks set primary_assignees = '{}', allowed_viewers = '{}'
  where id = '44520000-0000-4000-8000-000000000001';

  foreach v_link in array array[
    '44500000-0000-4000-8000-000000000002'::uuid,
    '44500000-0000-4000-8000-000000000003'::uuid
  ] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_link, 'role', 'authenticated')::text, true);
    select count(*) into v_rows from public.get_task_work_links('44520000-0000-4000-8000-000000000001');
    v_failed := false;
    begin
      perform * from public.add_task_work_link('44520000-0000-4000-8000-000000000001', null, 'https://drive.google.com/file/d/Revoked_' || replace(v_link::text, '-', '') || '/view');
    exception when insufficient_privilege then v_failed := true;
    end;
    v_ok := v_ok and v_rows = 0 and v_failed;
  end loop;
  v_results := v_results || format(E'\nASSIGNEE_AND_VIEWER_REVOCATION_NEXT_READ_WRITE_FAIL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '44500000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  select (links -> 0 ->> 'id')::uuid into v_link from public.get_task_work_links('44520000-0000-4000-8000-000000000002');
  v_failed := false;
  begin perform * from public.add_task_work_link('44520000-0000-4000-8000-000000000002', null, 'https://drive.google.com/file/d/ArchivedAdd/view'); exception when sqlstate 'CCL03' then v_failed := true; end;
  v_ok := v_failed;
  v_failed := false;
  begin perform public.remove_task_work_link(v_link); exception when sqlstate 'CCL03' then v_failed := true; end;
  v_ok := v_ok and v_failed;
  v_results := v_results || format(E'\nARCHIVED_ADD_AND_REMOVE_RPC_FAIL: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 6 — catalog, grants, locks, triggers, and unchanged policies

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '44600000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's4-catalog@test.local', '', now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now()
);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('44600000-0000-4000-8000-000000000001', 's4-catalog@test.local', 'Catalog Admin', 'Admin', null, true);

set constraints all immediate;

do $$
declare
  v_read_def text := pg_get_functiondef('public.get_task_work_links(uuid)'::regprocedure);
  v_guard_def text := pg_get_functiondef('public.guard_task_work_link_writes()'::regprocedure);
  v_update_def text := pg_get_functiondef('public.guard_task_work_link_updates()'::regprocedure);
  v_ok boolean;
  v_results text := '';
begin
  select c.relrowsecurity and not c.relforcerowsecurity into v_ok
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'task_work_links';
  v_ok := v_ok
    and (select count(*) = 0 from pg_policies where schemaname = 'public' and tablename = 'task_work_links')
    and not has_table_privilege('authenticated', 'public.task_work_links', 'SELECT')
    and not has_table_privilege('authenticated', 'public.task_work_links', 'INSERT')
    and not has_table_privilege('authenticated', 'public.task_work_links', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.task_work_links', 'DELETE')
    and not has_table_privilege('anon', 'public.task_work_links', 'SELECT')
    and not has_table_privilege('anon', 'public.task_work_links', 'INSERT')
    and not has_table_privilege('anon', 'public.task_work_links', 'UPDATE')
    and not has_table_privilege('anon', 'public.task_work_links', 'DELETE');
  v_results := v_results || format(E'\nRLS_DENY_DEFAULT_NO_DIRECT_TABLE_PRIVILEGES_OR_POLICIES: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 6 into v_ok
  from pg_proc p
  where p.oid in (
    'public.task_work_link_url_is_canonical(text)'::regprocedure,
    'public.guard_task_work_link_writes()'::regprocedure,
    'public.guard_task_work_link_updates()'::regprocedure,
    'public.get_task_work_links(uuid)'::regprocedure,
    'public.add_task_work_link(uuid,text,text)'::regprocedure,
    'public.remove_task_work_link(uuid)'::regprocedure
  ) and p.prosecdef;
  v_ok := v_ok
    and lower(v_read_def) like '%set search_path to ''''%'
    and lower(v_guard_def) like '%set search_path to ''''%'
    and lower(v_update_def) like '%set search_path to ''''%'
    and has_function_privilege('authenticated', 'public.get_task_work_links(uuid)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.add_task_work_link(uuid,text,text)', 'EXECUTE')
    and has_function_privilege('authenticated', 'public.remove_task_work_link(uuid)', 'EXECUTE')
    and not has_function_privilege('anon', 'public.get_task_work_links(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.task_work_link_url_is_canonical(text)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_task_work_link_writes()', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.guard_task_work_link_updates()', 'EXECUTE');
  v_results := v_results || format(E'\nDEFINER_EMPTY_PATH_AUTHENTICATED_ONLY_RPCS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_guard_def) like '%for no key update%'
    and lower(v_guard_def) like '%for share%'
    and lower(v_guard_def) like '%v_link_count >= 20%'
    and lower(v_guard_def) like '%pg_trigger_depth() > 1%'
    and lower(v_guard_def) like '%new.created_by := auth.uid()%'
    and lower(v_guard_def) like '%task_content_access%';
  v_results := v_results || format(E'\nTASK_NOKEYUPDATE_THEN_EVENT_SHARE_CAP_AND_CASCADE_BODY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_update_def) like '%old.created_by is not null%'
    and lower(v_update_def) like '%new.created_by is null%'
    and lower(v_update_def) like '%new.task_id%'
    and lower(v_update_def) like '%work links cannot be updated%';
  v_results := v_results || format(E'\nONLY_CREATED_BY_VALUE_TO_NULL_UPDATE_ALLOWED_BY_BODY: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 2 into v_ok
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'task_work_links'
    and not tg.tgisinternal
    and tg.tgname in ('task_work_links_guard_writes', 'task_work_links_reject_updates');
  v_results := v_results || format(E'\nBOTH_WORK_LINK_GUARDS_ATTACHED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 4 into v_ok from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname in ('tasks_select', 'tasks_insert', 'tasks_update', 'tasks_delete');
  v_ok := v_ok and (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'tasks');
  v_results := v_results || format(E'\nTASK_POLICIES_UNCHANGED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 4 into v_ok from pg_policies
  where schemaname = 'public' and tablename = 'users'
    and policyname in ('users_select_own_row', 'co_admin_view_own_committee_members', 'co_admin_update_own_committee_members', 'admin_full_access_users');
  v_ok := v_ok and (select count(*) = 4 from pg_policies where schemaname = 'public' and tablename = 'users');
  v_results := v_results || format(E'\nUSER_POLICIES_UNCHANGED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := exists (
    select 1 from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    where c.oid = 'public.tasks'::regclass
      and tg.tgname = 'tasks_guard_archived_event_writes'
      and not tg.tgisinternal
  );
  v_results := v_results || format(E'\nEXISTING_TASK_ARCHIVE_GUARD_STILL_ATTACHED: %s', case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 7 — orphaned creator keeps can_remove boolean

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('44700000-0000-4000-8000-000000000001'::uuid, 's4b-admin@test.local'),
  ('44700000-0000-4000-8000-000000000002'::uuid, 's4b-own@test.local'),
  ('44700000-0000-4000-8000-000000000003'::uuid, 's4b-creator@test.local'),
  ('44700000-0000-4000-8000-000000000004'::uuid, 's4b-member@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('44700000-0000-4000-8000-000000000001', 's4b-admin@test.local', 'Admin', 'Admin', null, true);
insert into public.users (id, email, full_name, role, committee_id, is_active)
select fixture.id, fixture.email, fixture.name, fixture.role, c.id, true
from (values
  ('44700000-0000-4000-8000-000000000002'::uuid, 's4b-own@test.local', 'Owning Co', 'Co-Admin'),
  ('44700000-0000-4000-8000-000000000003'::uuid, 's4b-creator@test.local', 'Disposable creator', 'Member'),
  ('44700000-0000-4000-8000-000000000004'::uuid, 's4b-member@test.local', 'Member assignee', 'Member')
) fixture(id, email, name, role)
cross join lateral (select id from public.committees order by name limit 1) c;

insert into public.events (id, name, start_date, end_date, status, created_by)
values (
  '44710000-0000-4000-8000-000000000001',
  'Orphan Boolean Active',
  '2026-12-17',
  '2026-12-18',
  'Active',
  '44700000-0000-4000-8000-000000000001'
);

insert into public.tasks (id, event_id, committee_id, title, primary_assignees)
select fixture.id, '44710000-0000-4000-8000-000000000001', c.id,
  fixture.title, fixture.assignees
from (values
  ('44720000-0000-4000-8000-000000000001'::uuid, 'Orphaned links', array[
    '44700000-0000-4000-8000-000000000003'::uuid,
    '44700000-0000-4000-8000-000000000004'::uuid
  ]),
  ('44720000-0000-4000-8000-000000000002'::uuid, 'Second active task', '{}'::uuid[])
) fixture(id, title, assignees)
cross join lateral (select id from public.committees order by name limit 1) c;

select set_config('request.jwt.claims', json_build_object('sub', '44700000-0000-4000-8000-000000000003', 'role', 'authenticated')::text, true);
select * from public.add_task_work_link('44720000-0000-4000-8000-000000000001', 'Orphan one', 'https://drive.google.com/file/d/OrphanBoolean_One/view');
select * from public.add_task_work_link('44720000-0000-4000-8000-000000000001', 'Orphan two', 'https://drive.google.com/file/d/OrphanBoolean_Two/view');

delete from auth.users
where id = '44700000-0000-4000-8000-000000000003';
set constraints all immediate;

do $$
declare
  v_ok boolean;
  v_types_ok boolean;
  v_all_types_ok boolean := true;
  v_results text := '';
begin
  select count(*) = 2 into v_ok
  from public.task_work_links
  where task_id = '44720000-0000-4000-8000-000000000001'
    and created_by is null;
  v_results := v_results || format(E'\nCREATOR_DELETE_ORPHANS_BOTH_LINKS: %s', case when v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '44700000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
  select
    count(*) = 2
      and coalesce(bool_and(item.value -> 'can_remove' = 'false'::jsonb), false),
    count(*) = 2
      and coalesce(bool_and(jsonb_typeof(item.value -> 'can_remove') = 'boolean'), false)
  into v_ok, v_types_ok
  from public.get_task_work_links('44720000-0000-4000-8000-000000000001') result,
  lateral jsonb_array_elements(result.links) item(value);
  v_all_types_ok := v_all_types_ok and v_types_ok;
  v_results := v_results || format(E'\nNON_CREATOR_MEMBER_GETS_BOOLEAN_FALSE: %s', case when v_ok and v_types_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '44700000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
  select
    count(*) = 2
      and coalesce(bool_and(item.value -> 'can_remove' = 'true'::jsonb), false),
    count(*) = 2
      and coalesce(bool_and(jsonb_typeof(item.value -> 'can_remove') = 'boolean'), false)
  into v_ok, v_types_ok
  from public.get_task_work_links('44720000-0000-4000-8000-000000000001') result,
  lateral jsonb_array_elements(result.links) item(value);
  v_all_types_ok := v_all_types_ok and v_types_ok;
  v_results := v_results || format(E'\nADMIN_GETS_BOOLEAN_TRUE: %s', case when v_ok and v_types_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub', '44700000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
  select
    count(*) = 2
      and coalesce(bool_and(item.value -> 'can_remove' = 'true'::jsonb), false),
    count(*) = 2
      and coalesce(bool_and(jsonb_typeof(item.value -> 'can_remove') = 'boolean'), false)
  into v_ok, v_types_ok
  from public.get_task_work_links('44720000-0000-4000-8000-000000000001') result,
  lateral jsonb_array_elements(result.links) item(value);
  v_all_types_ok := v_all_types_ok and v_types_ok;
  v_results := v_results || format(E'\nOWNING_CO_ADMIN_GETS_BOOLEAN_TRUE: %s', case when v_ok and v_types_ok then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nEVERY_CAN_REMOVE_VALUE_IS_BOOLEAN: %s', case when v_all_types_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

# Phase 4 Step 2 — read-only event Kanban tests

**Run on DEV only. Choose Run without RLS in the pop-up.**

> **Obsolete after Phase 4B Batch 0:** TEST 5 hard-codes the former
> `co_admin_update_own_committee_members` policy and four-policy count. Keep
> its historical result count unchanged; use
> `docs/phase-4b/step-0-tests.md` for the current `users` policy catalog.

Apply `20261016140000_read_only_event_board.sql` to Dev through the owner's
normal process before running these tests. Also re-run the existing
`get_task()` tests in `docs/PHASE-3-HARDENING-TESTS.md` on Dev after this
migration; Test 1 now requires a deactivated caller to receive zero rows.

Every test below is one self-contained SQL Editor paste. Tests 1–5 create
their own `auth.users`, profile, event, and task fixtures and impersonate their
own callers. Test 6 exercises the internal priority helper directly as the
migration owner. Every paste collects its assertions in one `v_results`
variable and ends with an intentional `raise exception 'TEST RESULTS ...'`;
that final exception rolls back the transaction. No test uses a temporary
table, touches `storage.objects`, or needs a second session. Deferred
constraints are forced before impersonation.

## TEST 1 — Active visibility, masking, and board/get_task parity

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('42100000-0000-4000-8000-000000000001'::uuid, 's2-admin@test.local'),
  ('42100000-0000-4000-8000-000000000002'::uuid, 's2-co-a@test.local'),
  ('42100000-0000-4000-8000-000000000003'::uuid, 's2-co-b@test.local'),
  ('42100000-0000-4000-8000-000000000004'::uuid, 's2-primary@test.local'),
  ('42100000-0000-4000-8000-000000000005'::uuid, 's2-assist@test.local'),
  ('42100000-0000-4000-8000-000000000006'::uuid, 's2-viewer@test.local'),
  ('42100000-0000-4000-8000-000000000007'::uuid, 's2-other@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values (
  '42100000-0000-4000-8000-000000000001',
  's2-admin@test.local', 'Step 2 Admin', 'Admin', null, true
);

with committees as (
  select id, row_number() over (order by name) as position
  from public.committees
), fixtures(id, email, full_name, role, committee_position) as (values
  ('42100000-0000-4000-8000-000000000002'::uuid, 's2-co-a@test.local', 'Step 2 Co A', 'Co-Admin', 1),
  ('42100000-0000-4000-8000-000000000003'::uuid, 's2-co-b@test.local', 'Step 2 Co B', 'Co-Admin', 2),
  ('42100000-0000-4000-8000-000000000004'::uuid, 's2-primary@test.local', 'Step 2 Primary', 'Member', 1),
  ('42100000-0000-4000-8000-000000000005'::uuid, 's2-assist@test.local', 'Step 2 Assist', 'Member', 1),
  ('42100000-0000-4000-8000-000000000006'::uuid, 's2-viewer@test.local', 'Step 2 Viewer', 'Member', 1),
  ('42100000-0000-4000-8000-000000000007'::uuid, 's2-other@test.local', 'Step 2 Other', 'Member', 1)
)
insert into public.users (id, email, full_name, role, committee_id, is_active)
select f.id, f.email, f.full_name, f.role, c.id, true
from fixtures f join committees c on c.position = f.committee_position;

insert into public.events (id, name, start_date, end_date, status, created_by)
values (
  '42200000-0000-4000-8000-000000000001', 'Step 2 Active matrix',
  '2026-11-01', '2026-11-02', 'Active',
  '42100000-0000-4000-8000-000000000001'
);

insert into public.tasks (
  id, event_id, committee_id, title, description, phase, status, priority,
  is_confidential, primary_assignees, assist_assignees, allowed_viewers
)
select
  '42300000-0000-4000-8000-000000000001',
  '42200000-0000-4000-8000-000000000001', committee_id,
  'PUBLIC ACTIVE CARD', 'Public description', 'Phase A', 'To Do', 'Medium',
  false, '{}'::uuid[], '{}'::uuid[], '{}'::uuid[]
from public.users where id = '42100000-0000-4000-8000-000000000002';

insert into public.tasks (
  id, event_id, committee_id, title, description, phase, status, priority,
  due_date, is_confidential, primary_assignees, assist_assignees, allowed_viewers
)
select
  '42300000-0000-4000-8000-000000000002',
  '42200000-0000-4000-8000-000000000001', committee_id,
  'SECRET ACTIVE CARD', 'Secret description', 'Phase A', 'In Progress', 'High',
  now() + interval '2 days', true,
  array['42100000-0000-4000-8000-000000000004'::uuid],
  array['42100000-0000-4000-8000-000000000005'::uuid],
  array['42100000-0000-4000-8000-000000000006'::uuid]
from public.users where id = '42100000-0000-4000-8000-000000000002';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '42100000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_case record;
  v_public_rows integer;
  v_board_decision text;
  v_detail_decision text;
  v_mask_ok boolean;
begin
  for v_case in
    select * from (values
      ('42100000-0000-4000-8000-000000000001'::uuid, 'real'),
      ('42100000-0000-4000-8000-000000000002'::uuid, 'real'),
      ('42100000-0000-4000-8000-000000000003'::uuid, 'masked'),
      ('42100000-0000-4000-8000-000000000004'::uuid, 'real'),
      ('42100000-0000-4000-8000-000000000005'::uuid, 'real'),
      ('42100000-0000-4000-8000-000000000006'::uuid, 'real'),
      ('42100000-0000-4000-8000-000000000007'::uuid, 'masked')
    ) cases(user_id, expected)
  loop
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_case.user_id, 'role', 'authenticated')::text,
      true
    );

    select count(*) into v_public_rows
    from public.list_event_board_tasks(
      '42200000-0000-4000-8000-000000000001', null
    )
    where id = '42300000-0000-4000-8000-000000000001'
      and title = 'PUBLIC ACTIVE CARD';

    select coalesce(max(case
      when title = 'SECRET ACTIVE CARD' and is_masked is false then 'real'
      when title = 'Confidential Task' and is_masked is true then 'masked'
      else 'invalid'
    end), 'hidden')
    into v_board_decision
    from public.list_event_board_tasks(
      '42200000-0000-4000-8000-000000000001', null
    )
    where id = '42300000-0000-4000-8000-000000000002';

    select coalesce(max(case
      when title = 'SECRET ACTIVE CARD' and description = 'Secret description' then 'real'
      when title = '🔒 Confidential Task' and description is null then 'masked'
      else 'invalid'
    end), 'hidden')
    into v_detail_decision
    from public.get_task('42300000-0000-4000-8000-000000000002');

    v_results := v_results || format(
      E'\nACTIVE_%s_PUBLIC_AND_PARITY: %s (public=%s board=%s detail=%s expected=%s)',
      v_case.user_id,
      case when v_public_rows = 1
                  and v_board_decision = v_case.expected
                  and v_detail_decision = v_case.expected
           then 'PASS' else 'FAIL' end,
      v_public_rows, v_board_decision, v_detail_decision, v_case.expected
    );
  end loop;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '42100000-0000-4000-8000-000000000003',
                      'role', 'authenticated')::text,
    true
  );

  select count(*) = 1 into v_mask_ok
  from public.list_event_board_tasks(
    '42200000-0000-4000-8000-000000000001', null
  )
  where id = '42300000-0000-4000-8000-000000000002'
    and title = 'Confidential Task'
    and phase = 'Phase A'
    and status = 'In Progress'
    and is_backlog is false
    and is_masked is true
    and effective_priority is null
    and due_date is null
    and committee_id is null
    and committee_name is null
    and primary_assignees = '[]'::jsonb
    and assist_assignees = '[]'::jsonb;
  v_results := v_results || format(
    E'\nOTHER_COMMITTEE_COADMIN_GETS_MASKED_NO_LEAK_SHELL: %s',
    case when v_mask_ok then 'PASS' else 'FAIL' end
  );

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 2 — Draft tasks are real only for Admin and owning Co-Admin

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('42400000-0000-4000-8000-000000000001'::uuid, 's2-draft-admin@test.local'),
  ('42400000-0000-4000-8000-000000000002'::uuid, 's2-draft-co-a@test.local'),
  ('42400000-0000-4000-8000-000000000003'::uuid, 's2-draft-co-b@test.local'),
  ('42400000-0000-4000-8000-000000000004'::uuid, 's2-draft-assigned@test.local'),
  ('42400000-0000-4000-8000-000000000005'::uuid, 's2-draft-viewer@test.local'),
  ('42400000-0000-4000-8000-000000000006'::uuid, 's2-draft-other@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('42400000-0000-4000-8000-000000000001',
  's2-draft-admin@test.local', 'Draft Admin', 'Admin', null, true);

with committees as (
  select id, row_number() over (order by name) as position from public.committees
), fixtures(id, email, full_name, role, committee_position) as (values
  ('42400000-0000-4000-8000-000000000002'::uuid, 's2-draft-co-a@test.local', 'Draft Co A', 'Co-Admin', 1),
  ('42400000-0000-4000-8000-000000000003'::uuid, 's2-draft-co-b@test.local', 'Draft Co B', 'Co-Admin', 2),
  ('42400000-0000-4000-8000-000000000004'::uuid, 's2-draft-assigned@test.local', 'Draft Assigned', 'Member', 1),
  ('42400000-0000-4000-8000-000000000005'::uuid, 's2-draft-viewer@test.local', 'Draft Viewer', 'Member', 1),
  ('42400000-0000-4000-8000-000000000006'::uuid, 's2-draft-other@test.local', 'Draft Other', 'Member', 1)
)
insert into public.users (id, email, full_name, role, committee_id, is_active)
select f.id, f.email, f.full_name, f.role, c.id, true
from fixtures f join committees c on c.position = f.committee_position;

insert into public.events (id, name, start_date, status, created_by)
values ('42500000-0000-4000-8000-000000000001', 'Step 2 Draft matrix',
  '2026-11-03', 'Draft', '42400000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, description, phase,
  is_confidential, primary_assignees, allowed_viewers
)
select fixture.id, '42500000-0000-4000-8000-000000000001', u.committee_id,
  fixture.title, fixture.description, 'Draft Phase', fixture.confidential,
  array['42400000-0000-4000-8000-000000000004'::uuid],
  array['42400000-0000-4000-8000-000000000005'::uuid]
from (values
  ('42600000-0000-4000-8000-000000000001'::uuid, 'DRAFT PUBLIC A', 'Draft public', false),
  ('42600000-0000-4000-8000-000000000002'::uuid, 'DRAFT SECRET A', 'Draft secret', true)
) fixture(id, title, description, confidential)
cross join public.users u
where u.id = '42400000-0000-4000-8000-000000000002';

insert into public.tasks (id, event_id, committee_id, title, phase, is_confidential)
select '42600000-0000-4000-8000-000000000003',
  '42500000-0000-4000-8000-000000000001', committee_id,
  'DRAFT SECRET B', 'Draft Phase', true
from public.users where id = '42400000-0000-4000-8000-000000000003';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '42400000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_case record;
  v_rows integer;
  v_masked integer;
  v_detail_rows integer;
begin
  for v_case in
    select * from (values
      ('42400000-0000-4000-8000-000000000001'::uuid, 3),
      ('42400000-0000-4000-8000-000000000002'::uuid, 2),
      ('42400000-0000-4000-8000-000000000003'::uuid, 1),
      ('42400000-0000-4000-8000-000000000004'::uuid, 0),
      ('42400000-0000-4000-8000-000000000005'::uuid, 0),
      ('42400000-0000-4000-8000-000000000006'::uuid, 0)
    ) cases(user_id, expected_rows)
  loop
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_case.user_id, 'role', 'authenticated')::text,
      true
    );
    select count(*), count(*) filter (where is_masked)
    into v_rows, v_masked
    from public.list_event_board_tasks(
      '42500000-0000-4000-8000-000000000001', null
    );
    select count(*) into v_detail_rows
    from public.get_task('42600000-0000-4000-8000-000000000002');

    v_results := v_results || format(
      E'\nDRAFT_%s_SCOPE_AND_NO_SHELLS: %s (board=%s masked=%s detail=%s)',
      v_case.user_id,
      case when v_rows = v_case.expected_rows
                  and v_masked = 0
                  and v_detail_rows = case when v_case.expected_rows > 0
                                           and v_case.user_id in (
                                             '42400000-0000-4000-8000-000000000001'::uuid,
                                             '42400000-0000-4000-8000-000000000002'::uuid
                                           ) then 1 else 0 end
           then 'PASS' else 'FAIL' end,
      v_rows, v_masked, v_detail_rows
    );
  end loop;

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 3 — profile minimization, Admin filter, and inactive callers

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('42700000-0000-4000-8000-000000000001'::uuid, 's2-filter-admin@test.local'),
  ('42700000-0000-4000-8000-000000000002'::uuid, 's2-filter-co@test.local'),
  ('42700000-0000-4000-8000-000000000003'::uuid, 's2-filter-member@test.local'),
  ('42700000-0000-4000-8000-000000000004'::uuid, 's2-former@test.local'),
  ('42700000-0000-4000-8000-000000000005'::uuid, 's2-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('42700000-0000-4000-8000-000000000001',
  's2-filter-admin@test.local', 'Filter Admin', 'Admin', null, true);

with committees as (
  select id, row_number() over (order by name) as position from public.committees
), fixtures(id, email, full_name, role, committee_position, active) as (values
  ('42700000-0000-4000-8000-000000000002'::uuid, 's2-filter-co@test.local', 'Filter Co', 'Co-Admin', 1, true),
  ('42700000-0000-4000-8000-000000000003'::uuid, 's2-filter-member@test.local', 'Filter Member', 'Member', 1, true),
  ('42700000-0000-4000-8000-000000000004'::uuid, 's2-former@test.local', 'Former Real Name', 'Member', 1, false)
)
insert into public.users (id, email, full_name, role, committee_id, is_active)
select f.id, f.email, f.full_name, f.role, c.id, f.active
from fixtures f join committees c on c.position = f.committee_position;

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('42800000-0000-4000-8000-000000000001', 'Step 2 filters',
  '2026-11-04', '2026-11-05', 'Active',
  '42700000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, primary_assignees
)
select '42900000-0000-4000-8000-000000000001',
  '42800000-0000-4000-8000-000000000001', committee_id,
  'COMMITTEE A', array['42700000-0000-4000-8000-000000000004'::uuid]
from public.users where id = '42700000-0000-4000-8000-000000000002';

insert into public.tasks (id, event_id, committee_id, title)
select '42900000-0000-4000-8000-000000000002',
  '42800000-0000-4000-8000-000000000001', id, 'COMMITTEE B'
from public.committees
where id <> (select committee_id from public.users
             where id = '42700000-0000-4000-8000-000000000002')
order by name limit 1;

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '42700000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_committee_id uuid;
  v_rows integer;
  v_other_rows integer;
  v_ok boolean;
  v_sqlstate text;
  v_user_id uuid;
begin
  select committee_id into v_committee_id from public.users
  where id = '42700000-0000-4000-8000-000000000002';

  select count(*) into v_rows
  from public.list_event_board_tasks(
    '42800000-0000-4000-8000-000000000001', v_committee_id
  );
  v_results := v_results || format(E'\nADMIN_FILTER_NARROWS_TO_ONE: %s',
    case when v_rows = 1 then 'PASS' else 'FAIL (' || v_rows || ')' end);

  select count(*) = 1 into v_ok
  from public.list_event_board_tasks(
    '42800000-0000-4000-8000-000000000001', null
  ) b
  cross join lateral jsonb_array_elements(b.primary_assignees) a
  where b.id = '42900000-0000-4000-8000-000000000001'
    and a ->> 'full_name' = 'Former Real Name'
    and (select array_agg(key order by key)
         from jsonb_object_keys(a) key)
        = array['avatar_url', 'full_name', 'id'];
  v_results := v_results || format(E'\nPROFILE_KEYS_MINIMAL_AND_FORMER_NAME_RETAINED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  for v_user_id in
    select user_id from (values
      ('42700000-0000-4000-8000-000000000002'::uuid),
      ('42700000-0000-4000-8000-000000000003'::uuid)
    ) callers(user_id)
  loop
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user_id, 'role', 'authenticated')::text,
      true
    );
    begin
      perform 1 from public.list_event_board_tasks(
        '42800000-0000-4000-8000-000000000001', v_committee_id
      );
      v_sqlstate := 'NO_ERROR';
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
    end;
    v_results := v_results || format(E'\nNON_ADMIN_FILTER_REJECTED_42501: %s (%s)',
      case when v_sqlstate = '42501' then 'PASS' else 'FAIL' end, v_sqlstate);
  end loop;

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '42700000-0000-4000-8000-000000000004',
                      'role', 'authenticated')::text,
    true
  );
  select
    (select count(*) from public.list_event_board_tasks(
      '42800000-0000-4000-8000-000000000001', null
    )),
    (select count(*) from public.get_task(
      '42900000-0000-4000-8000-000000000001'
    ))
  into v_rows, v_other_rows;
  v_results := v_results || format(E'\nINACTIVE_BOARD_AND_GET_TASK_ZERO: %s',
    case when v_rows = 0 and v_other_rows = 0 then 'PASS' else 'FAIL' end);

  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', '42700000-0000-4000-8000-000000000005',
                      'role', 'authenticated')::text,
    true
  );
  select count(*) into v_rows from (
    select id from public.list_event_board_tasks(
      '42800000-0000-4000-8000-000000000001', null
    )
    union all
    select id from public.get_task(
      '42900000-0000-4000-8000-000000000001'
    )
  ) denied_rows;
  v_results := v_results || format(E'\nPROFILELESS_BOARD_AND_GET_TASK_ZERO: %s',
    case when v_rows = 0 then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 4 — Archived and unknown event IDs are indistinguishable

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
select fixture.id, '00000000-0000-0000-0000-000000000000'::uuid,
  'authenticated', 'authenticated', fixture.email, '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
from (values
  ('42a00000-0000-4000-8000-000000000001'::uuid, 's2-oracle-admin@test.local'),
  ('42a00000-0000-4000-8000-000000000002'::uuid, 's2-oracle-co@test.local'),
  ('42a00000-0000-4000-8000-000000000003'::uuid, 's2-oracle-member@test.local'),
  ('42a00000-0000-4000-8000-000000000004'::uuid, 's2-oracle-inactive@test.local'),
  ('42a00000-0000-4000-8000-000000000005'::uuid, 's2-oracle-profileless@test.local')
) fixture(id, email);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('42a00000-0000-4000-8000-000000000001',
  's2-oracle-admin@test.local', 'Oracle Admin', 'Admin', null, true);

with c as (select id from public.committees order by name limit 1)
insert into public.users (id, email, full_name, role, committee_id, is_active)
select f.id, f.email, f.full_name, f.role, c.id, f.active
from c cross join (values
  ('42a00000-0000-4000-8000-000000000002'::uuid, 's2-oracle-co@test.local', 'Oracle Co', 'Co-Admin', true),
  ('42a00000-0000-4000-8000-000000000003'::uuid, 's2-oracle-member@test.local', 'Oracle Member', 'Member', true),
  ('42a00000-0000-4000-8000-000000000004'::uuid, 's2-oracle-inactive@test.local', 'Oracle Inactive', 'Member', false)
) f(id, email, full_name, role, active);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('42b00000-0000-4000-8000-000000000001', 'Oracle Archived',
  '2026-11-06', '2026-11-07', 'Active',
  '42a00000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title)
select '42c00000-0000-4000-8000-000000000001',
  '42b00000-0000-4000-8000-000000000001', committee_id, 'Archived secret existence'
from public.users where id = '42a00000-0000-4000-8000-000000000002';

update public.events set status = 'Archived'
where id = '42b00000-0000-4000-8000-000000000001';

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '42a00000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_user_id uuid;
  v_archived_rows integer;
  v_missing_rows integer;
  v_archived_error text;
  v_missing_error text;
begin
  foreach v_user_id in array array[
    '42a00000-0000-4000-8000-000000000001'::uuid,
    '42a00000-0000-4000-8000-000000000002'::uuid,
    '42a00000-0000-4000-8000-000000000003'::uuid,
    '42a00000-0000-4000-8000-000000000004'::uuid,
    '42a00000-0000-4000-8000-000000000005'::uuid
  ] loop
    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user_id, 'role', 'authenticated')::text,
      true
    );
    v_archived_error := null;
    v_missing_error := null;
    v_archived_rows := null;
    v_missing_rows := null;
    begin
      select count(*) into v_archived_rows
      from public.list_event_board_tasks(
        '42b00000-0000-4000-8000-000000000001', null
      );
    exception when others then
      get stacked diagnostics v_archived_error = returned_sqlstate;
    end;
    begin
      select count(*) into v_missing_rows
      from public.list_event_board_tasks(
        '42b00000-0000-4000-8000-000000000099', null
      );
    exception when others then
      get stacked diagnostics v_missing_error = returned_sqlstate;
    end;

    v_results := v_results || format(
      E'\nARCHIVED_UNKNOWN_NO_ORACLE_%s: %s (archived=%s/%s missing=%s/%s)',
      v_user_id,
      case when v_archived_error is null and v_missing_error is null
                  and v_archived_rows = 0 and v_missing_rows = 0
           then 'PASS' else 'FAIL' end,
      coalesce(v_archived_rows::text, 'null'), coalesce(v_archived_error, 'no-error'),
      coalesce(v_missing_rows::text, 'null'), coalesce(v_missing_error, 'no-error')
    );
  end loop;

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 5 — policies and function catalogs remain narrow

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values (
  '42d00000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's2-catalog@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.users (id, email, full_name, role, committee_id, is_active)
values ('42d00000-0000-4000-8000-000000000001',
  's2-catalog@test.local', 'Catalog Admin', 'Admin', null, true);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('42e00000-0000-4000-8000-000000000001', 'Catalog event',
  '2026-11-08', '2026-11-09', 'Active',
  '42d00000-0000-4000-8000-000000000001');

insert into public.tasks (id, event_id, committee_id, title)
select '42f00000-0000-4000-8000-000000000001',
  '42e00000-0000-4000-8000-000000000001', id, 'Catalog task'
from public.committees order by name limit 1;

set constraints all immediate;
set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub', '42d00000-0000-4000-8000-000000000001',
                    'role', 'authenticated')::text,
  true
);

do $$
declare
  v_results text := '';
  v_ok boolean;
  v_rows integer;
  v_board_def text;
  v_access_def text;
  v_priority_def text;
  v_select_qual text;
begin
  select pg_get_functiondef(
    'public.list_event_board_tasks(uuid,uuid)'::regprocedure
  ) into v_board_def;
  select pg_get_functiondef(
    'public.task_content_access(uuid)'::regprocedure
  ) into v_access_def;
  select pg_get_functiondef(
    'public.calculate_effective_task_priority(text,timestamp with time zone,timestamp with time zone,text)'::regprocedure
  ) into v_priority_def;

  select count(*) = 1 into v_ok
  from pg_proc p
  where p.oid = 'public.list_event_board_tasks(uuid,uuid)'::regprocedure
    and p.prosecdef
    and pg_get_function_result(p.oid) =
      'TABLE(id uuid, title text, phase text, status text, effective_priority text, due_date timestamp with time zone, committee_id uuid, committee_name text, primary_assignees jsonb, assist_assignees jsonb, is_backlog boolean, is_masked boolean)';
  v_results := v_results || format(E'\nBOARD_FIXED_RETURN_SHAPE_AND_DEFINER: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) = 1 into v_ok
  from pg_proc p
  where p.oid = 'public.task_content_access(uuid)'::regprocedure
    and p.prosecdef
    and lower(pg_get_function_result(p.oid)) = 'text';
  v_results := v_results || format(E'\nCONTENT_HELPER_ONE_TEXT_SIGNATURE_AND_DEFINER: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_board_def) like '%set search_path to ''''%'
    and lower(v_access_def) like '%set search_path to ''''%'
    and lower(v_priority_def) like '%set search_path to ''''%';
  v_results := v_results || format(E'\nALL_NEW_FUNCTIONS_EMPTY_SEARCH_PATH: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_board_def) like '%task_content_access%'
    and lower(pg_get_functiondef('public.get_task(uuid)'::regprocedure))
        like '%task_content_access%';
  v_results := v_results || format(E'\nBOARD_AND_GET_TASK_SHARE_HELPER: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := has_function_privilege(
      'authenticated', 'public.list_event_board_tasks(uuid,uuid)', 'EXECUTE'
    )
    and has_function_privilege(
      'authenticated', 'public.get_task(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'anon', 'public.list_event_board_tasks(uuid,uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'anon', 'public.get_task(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated', 'public.task_content_access(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'authenticated',
      'public.calculate_effective_task_priority(text,timestamp with time zone,timestamp with time zone,text)',
      'EXECUTE'
    )
    and not has_function_privilege(
      'anon', 'public.task_content_access(uuid)', 'EXECUTE'
    )
    and not has_function_privilege(
      'anon',
      'public.calculate_effective_task_priority(text,timestamp with time zone,timestamp with time zone,text)',
      'EXECUTE'
    );
  v_results := v_results || format(E'\nONLY_BOARD_AND_GET_TASK_AUTHENTICATED_EXECUTABLE: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  v_ok := lower(v_board_def) !~ '\m(insert|update|delete|merge)\M'
    and lower(v_access_def) !~ '\m(insert|update|delete|merge)\M';
  v_results := v_results || format(E'\nBOARD_AND_HELPER_HAVE_NO_WRITE_STATEMENTS: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select qual into v_select_qual from pg_policies
  where schemaname = 'public' and tablename = 'tasks'
    and policyname = 'tasks_select';
  v_ok := lower(v_select_qual) like '%my_role() is not null%'
    and lower(v_select_qual) not like '%request_backup%'
    and lower(v_select_qual) not like '%allowed_viewers%';
  v_results := v_results || format(E'\nRAW_TASKS_SELECT_UNCHANGED_AND_HARDENED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(*) into v_rows from pg_policies
  where schemaname = 'public' and tablename = 'users'
    and policyname in (
      'users_select_own_row',
      'co_admin_view_own_committee_members',
      'co_admin_update_own_committee_members',
      'admin_full_access_users'
    );
  v_results := v_results || format(E'\nFOUR_EXISTING_USERS_POLICIES_UNCHANGED: %s',
    case when v_rows = 4 then 'PASS' else 'FAIL (' || v_rows || ')' end);

  select count(*) = 4 into v_ok
  from pg_policies
  where schemaname = 'public' and tablename = 'users'
    and (
      (policyname = 'users_select_own_row'
       and cmd = 'SELECT'
       and lower(qual) like '%id = auth.uid()%')
      or
      (policyname = 'co_admin_view_own_committee_members'
       and cmd = 'SELECT'
       and lower(qual) like '%my_role() = ''co-admin''%'
       and lower(qual) like '%my_committee_id() = committee_id%')
      or
      (policyname = 'co_admin_update_own_committee_members'
       and cmd = 'UPDATE'
       and lower(qual) like '%my_role() = ''co-admin''%'
       and lower(with_check) like '%role <> ''admin''%')
      or
      (policyname = 'admin_full_access_users'
       and cmd = 'ALL'
       and lower(qual) like '%my_role() = ''admin''%')
    );
  v_results := v_results || format(E'\nUSERS_POLICY_COMMANDS_AND_RULES_UNCHANGED: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  select count(distinct pg_get_userbyid(p.proowner)) = 1 into v_ok
  from pg_proc p
  where p.oid in (
    'public.list_event_board_tasks(uuid,uuid)'::regprocedure,
    'public.task_content_access(uuid)'::regprocedure,
    'public.get_task(uuid)'::regprocedure,
    'public.guard_event_updates()'::regprocedure
  );
  v_results := v_results || format(E'\nMIGRATION_OWNER_MATCHES_EXISTING_DEFINERS: %s',
    case when v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

## TEST 6 — effective-priority boundaries

```sql
begin;

-- Run this block as the migration owner. The internal helper intentionally
-- grants no EXECUTE privilege to authenticated callers.

do $$
declare
  v_results text := '';
  v_as_of timestamptz := '2026-11-10 12:00:00+00';
  v_actual text;
begin
  select public.calculate_effective_task_priority(
    'Low', null, v_as_of, 'To Do'
  )
  into v_actual;
  v_results := v_results || format(E'\nNULL_DUE_KEEPS_LOW: %s',
    case when v_actual = 'Low' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'Medium', v_as_of + interval '24 hours 1 microsecond', v_as_of, 'To Do'
  ) into v_actual;
  v_results := v_results || format(E'\nBEYOND_24H_KEEPS_MEDIUM: %s',
    case when v_actual = 'Medium' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'Low', v_as_of + interval '24 hours', v_as_of, 'To Do'
  ) into v_actual;
  v_results := v_results || format(E'\nEXACTLY_24H_IS_HIGH: %s',
    case when v_actual = 'High' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'Medium', v_as_of, v_as_of, 'In Progress'
  )
  into v_actual;
  v_results := v_results || format(E'\nEXACTLY_DUE_IS_HIGH: %s',
    case when v_actual = 'High' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'Low', v_as_of - interval '1 microsecond', v_as_of, 'To Do'
  ) into v_actual;
  v_results := v_results || format(E'\nOVERDUE_TO_DO_IS_CRITICAL: %s',
    case when v_actual = 'Critical' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'Medium', v_as_of - interval '1 microsecond', v_as_of, 'In Progress'
  ) into v_actual;
  v_results := v_results || format(E'\nOVERDUE_IN_PROGRESS_IS_CRITICAL: %s',
    case when v_actual = 'Critical' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'Low', v_as_of - interval '1 day', v_as_of, 'Completed'
  ) into v_actual;
  v_results := v_results || format(E'\nOVERDUE_COMPLETED_KEEPS_LOW: %s',
    case when v_actual = 'Low' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'Medium', v_as_of + interval '2 hours', v_as_of, 'Completed'
  ) into v_actual;
  v_results := v_results || format(E'\nCOMPLETED_WITHIN_24H_KEEPS_MEDIUM: %s',
    case when v_actual = 'Medium' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'High', v_as_of + interval '2 hours', v_as_of, 'To Do'
  ) into v_actual;
  v_results := v_results || format(E'\nHIGH_IS_NOT_LOWERED: %s',
    case when v_actual = 'High' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  select public.calculate_effective_task_priority(
    'Critical', v_as_of + interval '2 days', v_as_of, 'In Progress'
  ) into v_actual;
  v_results := v_results || format(E'\nCRITICAL_IS_NOT_LOWERED: %s',
    case when v_actual = 'Critical' then 'PASS' else 'FAIL (' || v_actual || ')' end);

  raise exception 'TEST RESULTS %', v_results;
end
$$;
```

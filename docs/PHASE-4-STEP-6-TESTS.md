# Phase 4 Step 6 — board ordering and move UI tests

**Run SQL tests on DEV only. Choose Run without RLS in the pop-up.**

Apply `20261018140000_order_event_board_by_sort_order.sql` to Dev through the
owner's normal process before running these tests. Each numbered SQL test is
one self-contained SQL Editor paste with its own Auth/profile/event/task
fixtures and caller impersonation. Every paste ends with an intentional
`raise exception 'TEST RESULTS ...'`, which rolls the transaction back.

No test creates a temporary table or touches `storage.objects`. Expected
values are computed as the table owner before impersonation. Catalog checks
use `pg_proc` fields rather than function source text. Choose **Run without
RLS** for every paste.

## SQL TEST 1 — reader catalog, grants, exact return shape, and hidden rank

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values (
  '60010000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 's6-catalog@test.local', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now()
);

insert into public.committees (id, name)
values ('60010000-0000-4000-8000-000000000010', 'S6 Catalog Committee');

insert into public.users (id, email, full_name, role, committee_id, is_active)
values (
  '60010000-0000-4000-8000-000000000001',
  's6-catalog@test.local', 'S6 Catalog Admin', 'Admin', null, true
);

insert into public.events (
  id, name, start_date, end_date, status, created_by
) values (
  '60010000-0000-4000-8000-000000000020', 'S6 Catalog Event',
  '2026-10-18', '2026-10-19', 'Active',
  '60010000-0000-4000-8000-000000000001'
);

insert into public.tasks (
  id, event_id, committee_id, title, phase, status, priority,
  primary_assignees, assist_assignees, is_confidential, created_by,
  sort_order, created_at
) values
  (
    '60010000-0000-4000-8000-000000000031',
    '60010000-0000-4000-8000-000000000020',
    '60010000-0000-4000-8000-000000000010',
    'Created earlier but ranked second', 'Setup', 'To Do', 'Medium',
    '{}', '{}', false, '60010000-0000-4000-8000-000000000001',
    2048, '2026-01-01T00:00:00Z'
  ),
  (
    '60010000-0000-4000-8000-000000000032',
    '60010000-0000-4000-8000-000000000020',
    '60010000-0000-4000-8000-000000000010',
    'Created later but ranked first', 'Setup', 'To Do', 'Medium',
    '{}', '{}', false, '60010000-0000-4000-8000-000000000001',
    1024, '2026-10-18T00:00:00Z'
  );

-- The creation trigger always chooses the initial lane tail. Set deliberately
-- reversed, unused ranks as the owner after insert so this test exercises the
-- reader's sort_order contract rather than the trigger's insertion order.
update public.tasks
set sort_order = case id
  when '60010000-0000-4000-8000-000000000031' then 8192
  when '60010000-0000-4000-8000-000000000032' then 4096
end
where id in (
  '60010000-0000-4000-8000-000000000031',
  '60010000-0000-4000-8000-000000000032'
);

select set_config(
  'test.s6_owner',
  pg_catalog.pg_get_userbyid(p.proowner),
  true
)
from pg_catalog.pg_proc p
where p.oid = 'public.list_event_board_tasks(uuid,uuid)'::regprocedure;

select set_config(
  'test.s6_outputs',
  coalesce(
    (
      select array_agg(args.arg_name order by args.ordinality)::text
      from pg_catalog.pg_proc p
      cross join lateral unnest(p.proargnames, p.proargmodes)
        with ordinality as args(arg_name, arg_mode, ordinality)
      where p.oid = 'public.list_event_board_tasks(uuid,uuid)'::regprocedure
        and args.arg_mode::text in ('o', 't', 'b')
    ),
    '{}'
  ),
  true
);

select set_config(
  'test.s6_expected_order',
  array_agg(t.id::text order by t.sort_order, t.id)::text,
  true
)
from public.tasks t
where t.event_id = '60010000-0000-4000-8000-000000000020';

select set_config(
  'test.s6_fixture_orders_differ',
  (
    array_agg(t.id order by t.sort_order, t.id)
    is distinct from array_agg(t.id order by t.created_at, t.id)
  )::text,
  true
)
from public.tasks t
where t.event_id = '60010000-0000-4000-8000-000000000020';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object(
    'sub', '60010000-0000-4000-8000-000000000001',
    'role', 'authenticated'
  )::text,
  true
);

do $$
declare
  v_oid oid := 'public.list_event_board_tasks(uuid,uuid)'::regprocedure;
  v_order text;
  v_runtime_shape_ok boolean;
  v_ok boolean;
  v_results text := '';
begin
  select p.prosecdef
    and p.provolatile = 's'
    and coalesce(p.proconfig, '{}'::text[]) @> array['search_path=""']
    and current_setting('test.s6_owner') = 'postgres'
  into v_ok
  from pg_catalog.pg_proc p
  where p.oid = v_oid;
  v_results := v_results || format(
    E'\nSTABLE_DEFINER_OWNER_EMPTY_PATH: %s',
    case when v_ok then 'PASS' else 'FAIL' end
  );

  v_ok := current_setting('test.s6_outputs') =
    '{id,title,phase,status,effective_priority,due_date,committee_id,committee_name,primary_assignees,assist_assignees,is_backlog,is_masked}';
  v_results := v_results || format(
    E'\nEXACT_OUTPUTS_NO_SORT_ORDER: %s',
    case when v_ok then 'PASS' else 'FAIL' end
  );

  select has_function_privilege('authenticated', v_oid, 'EXECUTE')
    and not has_function_privilege('anon', v_oid, 'EXECUTE')
    and not exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) acl
      where p.oid = v_oid
        and acl.grantee = 0
        and acl.privilege_type = 'EXECUTE'
    )
  into v_ok;
  v_results := v_results || format(
    E'\nAUTHENTICATED_ONLY_GRANT: %s',
    case when v_ok then 'PASS' else 'FAIL' end
  );

  select array_agg(board.id::text order by board.ordinality)::text,
         bool_and(
           not (to_jsonb(board) ? 'sort_order')
           and jsonb_object_length(to_jsonb(board) - 'ordinality') = 12
         )
  into v_order, v_runtime_shape_ok
  from public.list_event_board_tasks(
    '60010000-0000-4000-8000-000000000020', null
  ) with ordinality as board;

  v_results := v_results || format(
    E'\nORDER_IS_SORT_ORDER_NOT_CREATED_AT: %s',
    case when v_order = current_setting('test.s6_expected_order') then 'PASS' else 'FAIL' end
  );
  v_results := v_results || format(
    E'\nFIXTURE_SORT_ORDER_DIFFERS_FROM_CREATED_AT: %s',
    case when current_setting('test.s6_fixture_orders_differ')::boolean then 'PASS' else 'FAIL' end
  );
  v_results := v_results || format(
    E'\nRUNTIME_SHAPE_HAS_NO_RANK: %s',
    case when v_runtime_shape_ok then 'PASS' else 'FAIL' end
  );

  raise exception 'TEST RESULTS %', v_results;
end;
$$;
```

## SQL TEST 2 — Active ordering and real/masked parity for all roles

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('60020000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s6-admin@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('60020000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s6-coadmin@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('60020000-0000-4000-8000-000000000003','00000000-0000-0000-8000-000000000000','authenticated','authenticated','s6-assigned@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('60020000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s6-unassigned@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into public.committees (id, name) values
  ('60020000-0000-4000-8000-000000000010', 'S6 Committee A'),
  ('60020000-0000-4000-8000-000000000011', 'S6 Committee B');

insert into public.users (id, email, full_name, role, committee_id, is_active) values
  ('60020000-0000-4000-8000-000000000001','s6-admin@test.local','S6 Admin','Admin',null,true),
  ('60020000-0000-4000-8000-000000000002','s6-coadmin@test.local','S6 Co-Admin','Co-Admin','60020000-0000-4000-8000-000000000010',true),
  ('60020000-0000-4000-8000-000000000003','s6-assigned@test.local','S6 Assigned','Member','60020000-0000-4000-8000-000000000011',true),
  ('60020000-0000-4000-8000-000000000004','s6-unassigned@test.local','S6 Unassigned','Member','60020000-0000-4000-8000-000000000011',true);

insert into public.events (id, name, start_date, end_date, status, created_by)
values ('60020000-0000-4000-8000-000000000020','S6 Active Event','2026-10-18','2026-10-19','Active','60020000-0000-4000-8000-000000000001');

insert into public.tasks (
  id, event_id, committee_id, title, phase, status, priority,
  primary_assignees, assist_assignees, is_confidential, created_by,
  sort_order, created_at
) values
  ('60020000-0000-4000-8000-000000000031','60020000-0000-4000-8000-000000000020','60020000-0000-4000-8000-000000000011','Public rank one','Setup','To Do','Low','{}','{}',false,'60020000-0000-4000-8000-000000000001',1024,'2026-10-18T04:00:00Z'),
  ('60020000-0000-4000-8000-000000000032','60020000-0000-4000-8000-000000000020','60020000-0000-4000-8000-000000000010','Assigned confidential rank two','Setup','To Do','Medium',array['60020000-0000-4000-8000-000000000003'::uuid],'{}',true,'60020000-0000-4000-8000-000000000001',2048,'2026-10-18T03:00:00Z'),
  ('60020000-0000-4000-8000-000000000033','60020000-0000-4000-8000-000000000020','60020000-0000-4000-8000-000000000011','Other confidential rank three','Setup','To Do','High','{}','{}',true,'60020000-0000-4000-8000-000000000001',3072,'2026-10-18T02:00:00Z'),
  ('60020000-0000-4000-8000-000000000034','60020000-0000-4000-8000-000000000020','60020000-0000-4000-8000-000000000010','Public rank four','Setup','To Do','Critical','{}','{}',false,'60020000-0000-4000-8000-000000000001',4096,'2026-10-18T01:00:00Z');

select set_config(
  'test.s6_expected_order',
  array_agg(t.id::text order by t.sort_order, t.id)::text,
  true
)
from public.tasks t
where t.event_id = '60020000-0000-4000-8000-000000000020';

set local role authenticated;

do $$
declare
  v_order text;
  v_ok boolean;
  v_results text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub','60020000-0000-4000-8000-000000000001','role','authenticated')::text, true);
  select array_agg(b.id::text order by b.ordinality)::text,
         bool_and(not b.is_masked)
  into v_order, v_ok
  from public.list_event_board_tasks('60020000-0000-4000-8000-000000000020', null) with ordinality b;
  v_results := v_results || format(E'\nADMIN_SORT_ORDER_AND_ALL_REAL: %s', case when v_order = current_setting('test.s6_expected_order') and v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','60020000-0000-4000-8000-000000000002','role','authenticated')::text, true);
  select array_agg(b.id::text order by b.ordinality)::text,
         count(*) filter (where b.id = '60020000-0000-4000-8000-000000000032' and not b.is_masked) = 1
         and count(*) filter (
           where b.id = '60020000-0000-4000-8000-000000000033'
             and b.is_masked and b.title = 'Confidential Task'
             and b.committee_id is null and b.effective_priority is null
             and b.primary_assignees = '[]'::jsonb
         ) = 1
  into v_order, v_ok
  from public.list_event_board_tasks('60020000-0000-4000-8000-000000000020', null) with ordinality b;
  v_results := v_results || format(E'\nCOADMIN_ORDER_REAL_AND_MASKED: %s', case when v_order = current_setting('test.s6_expected_order') and v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','60020000-0000-4000-8000-000000000003','role','authenticated')::text, true);
  select array_agg(b.id::text order by b.ordinality)::text,
         count(*) filter (where b.id = '60020000-0000-4000-8000-000000000032' and not b.is_masked and b.title = 'Assigned confidential rank two') = 1
         and count(*) filter (where b.id = '60020000-0000-4000-8000-000000000033' and b.is_masked and b.title = 'Confidential Task') = 1
  into v_order, v_ok
  from public.list_event_board_tasks('60020000-0000-4000-8000-000000000020', null) with ordinality b;
  v_results := v_results || format(E'\nASSIGNED_MEMBER_ORDER_REAL_AND_MASKED: %s', case when v_order = current_setting('test.s6_expected_order') and v_ok then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','60020000-0000-4000-8000-000000000004','role','authenticated')::text, true);
  select array_agg(b.id::text order by b.ordinality)::text,
         count(*) filter (where b.is_masked) = 2
         and bool_and(
           case when b.is_masked then
             b.title = 'Confidential Task'
             and b.committee_id is null and b.committee_name is null
             and b.effective_priority is null and b.due_date is null
             and b.primary_assignees = '[]'::jsonb
             and b.assist_assignees = '[]'::jsonb
           else true end
         )
  into v_order, v_ok
  from public.list_event_board_tasks('60020000-0000-4000-8000-000000000020', null) with ordinality b;
  v_results := v_results || format(E'\nUNASSIGNED_MEMBER_MASKED_SHELLS_STAY_ORDERED: %s', case when v_order = current_setting('test.s6_expected_order') and v_ok then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end;
$$;
```

## SQL TEST 3 — Draft, Archived, unknown, and filter behavior remain unchanged

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values
  ('60030000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s6-life-admin@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('60030000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s6-life-co@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now()),
  ('60030000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s6-life-member@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into public.committees (id, name) values
  ('60030000-0000-4000-8000-000000000010','S6 Life Committee A'),
  ('60030000-0000-4000-8000-000000000011','S6 Life Committee B');

insert into public.users (id,email,full_name,role,committee_id,is_active) values
  ('60030000-0000-4000-8000-000000000001','s6-life-admin@test.local','S6 Life Admin','Admin',null,true),
  ('60030000-0000-4000-8000-000000000002','s6-life-co@test.local','S6 Life Co-Admin','Co-Admin','60030000-0000-4000-8000-000000000010',true),
  ('60030000-0000-4000-8000-000000000003','s6-life-member@test.local','S6 Life Member','Member','60030000-0000-4000-8000-000000000010',true);

insert into public.events (id,name,start_date,end_date,status,created_by) values
  ('60030000-0000-4000-8000-000000000020','S6 Draft','2026-10-18',null,'Draft','60030000-0000-4000-8000-000000000001'),
  ('60030000-0000-4000-8000-000000000021','S6 Archived','2026-10-01','2026-10-02','Active','60030000-0000-4000-8000-000000000001');

insert into public.tasks (
  id,event_id,committee_id,title,phase,status,priority,
  primary_assignees,assist_assignees,is_confidential,created_by,sort_order
) values
  ('60030000-0000-4000-8000-000000000031','60030000-0000-4000-8000-000000000020','60030000-0000-4000-8000-000000000010','Draft own second','Setup','To Do','Medium','{}','{}',false,'60030000-0000-4000-8000-000000000001',2048),
  ('60030000-0000-4000-8000-000000000032','60030000-0000-4000-8000-000000000020','60030000-0000-4000-8000-000000000010','Draft own first','Setup','To Do','Medium','{}','{}',false,'60030000-0000-4000-8000-000000000001',1024),
  ('60030000-0000-4000-8000-000000000033','60030000-0000-4000-8000-000000000020','60030000-0000-4000-8000-000000000011','Draft other committee','Setup','To Do','Medium','{}','{}',false,'60030000-0000-4000-8000-000000000001',3072),
  ('60030000-0000-4000-8000-000000000034','60030000-0000-4000-8000-000000000021','60030000-0000-4000-8000-000000000010','Archived task','Setup','To Do','Medium','{}','{}',false,'60030000-0000-4000-8000-000000000001',1024);

-- Build the historical row while writable, then archive as the table owner.
update public.events
set status = 'Archived'
where id = '60030000-0000-4000-8000-000000000021';

select set_config(
  'test.s6_draft_admin_order',
  array_agg(t.id::text order by t.sort_order, t.id)::text,
  true
)
from public.tasks t
where t.event_id = '60030000-0000-4000-8000-000000000020';

select set_config(
  'test.s6_draft_co_order',
  array_agg(t.id::text order by t.sort_order, t.id)::text,
  true
)
from public.tasks t
where t.event_id = '60030000-0000-4000-8000-000000000020'
  and t.committee_id = '60030000-0000-4000-8000-000000000010';

set local role authenticated;

do $$
declare
  v_order text;
  v_count integer;
  v_denied boolean := false;
  v_results text := '';
begin
  perform set_config('request.jwt.claims', json_build_object('sub','60030000-0000-4000-8000-000000000001','role','authenticated')::text, true);
  select array_agg(b.id::text order by b.ordinality)::text into v_order
  from public.list_event_board_tasks('60030000-0000-4000-8000-000000000020', null) with ordinality b;
  v_results := v_results || format(E'\nADMIN_DRAFT_ORDER_UNCHANGED: %s', case when v_order = current_setting('test.s6_draft_admin_order') then 'PASS' else 'FAIL' end);

  select count(*) into v_count
  from public.list_event_board_tasks('60030000-0000-4000-8000-000000000021', null);
  v_results := v_results || format(E'\nARCHIVED_STILL_ZERO_ROWS: %s', case when v_count = 0 then 'PASS' else 'FAIL' end);

  select count(*) into v_count
  from public.list_event_board_tasks('60030000-0000-4000-8000-000000009999', null);
  v_results := v_results || format(E'\nUNKNOWN_STILL_ZERO_ROWS: %s', case when v_count = 0 then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','60030000-0000-4000-8000-000000000002','role','authenticated')::text, true);
  select array_agg(b.id::text order by b.ordinality)::text into v_order
  from public.list_event_board_tasks('60030000-0000-4000-8000-000000000020', null) with ordinality b;
  v_results := v_results || format(E'\nOWNING_COADMIN_DRAFT_REAL_ORDER: %s', case when v_order = current_setting('test.s6_draft_co_order') then 'PASS' else 'FAIL' end);

  begin
    perform * from public.list_event_board_tasks(
      '60030000-0000-4000-8000-000000000020',
      '60030000-0000-4000-8000-000000000010'
    );
  exception when insufficient_privilege then
    v_denied := true;
  end;
  v_results := v_results || format(E'\nCOADMIN_FILTER_STILL_DENIED: %s', case when v_denied then 'PASS' else 'FAIL' end);

  perform set_config('request.jwt.claims', json_build_object('sub','60030000-0000-4000-8000-000000000003','role','authenticated')::text, true);
  select count(*) into v_count
  from public.list_event_board_tasks('60030000-0000-4000-8000-000000000020', null);
  v_results := v_results || format(E'\nMEMBER_DRAFT_STILL_ZERO_ROWS: %s', case when v_count = 0 then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end;
$$;
```

## SQL TEST 4 — normal-RPC Undo hints reject stale, removed, forged, and non-boundary placement

```sql
begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
) values ('60040000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','s6-move-admin@test.local','',now(),'{"provider":"email","providers":["email"]}','{}',now(),now());

insert into public.committees (id,name)
values ('60040000-0000-4000-8000-000000000010','S6 Move Committee');

insert into public.users (id,email,full_name,role,committee_id,is_active)
values ('60040000-0000-4000-8000-000000000001','s6-move-admin@test.local','S6 Move Admin','Admin',null,true);

insert into public.events (id,name,start_date,end_date,status,created_by)
values ('60040000-0000-4000-8000-000000000020','S6 Move Event','2026-10-18','2026-10-19','Active','60040000-0000-4000-8000-000000000001');

insert into public.tasks (
  id,event_id,committee_id,title,phase,status,priority,
  primary_assignees,assist_assignees,is_confidential,created_by,sort_order
) values
  ('60040000-0000-4000-8000-000000000031','60040000-0000-4000-8000-000000000020','60040000-0000-4000-8000-000000000010','A','Setup','To Do','Medium','{}','{}',false,'60040000-0000-4000-8000-000000000001',1024),
  ('60040000-0000-4000-8000-000000000032','60040000-0000-4000-8000-000000000020','60040000-0000-4000-8000-000000000010','B','Setup','To Do','Medium','{}','{}',false,'60040000-0000-4000-8000-000000000001',2048),
  ('60040000-0000-4000-8000-000000000033','60040000-0000-4000-8000-000000000020','60040000-0000-4000-8000-000000000010','C','Setup','To Do','Medium','{}','{}',false,'60040000-0000-4000-8000-000000000001',3072),
  ('60040000-0000-4000-8000-000000000034','60040000-0000-4000-8000-000000000020','60040000-0000-4000-8000-000000000010','Other lane','Setup','In Progress','Medium','{}','{}',false,'60040000-0000-4000-8000-000000000001',1024),
  ('60040000-0000-4000-8000-000000000035','60040000-0000-4000-8000-000000000020','60040000-0000-4000-8000-000000000010','Removed neighbor','Setup','To Do','Medium','{}','{}',false,'60040000-0000-4000-8000-000000000001',4096);

-- The missing-neighbor expectation is established by the table owner before
-- impersonation. This simulates a neighbor removed before Undo is submitted.
delete from public.tasks
where id = '60040000-0000-4000-8000-000000000035';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  json_build_object('sub','60040000-0000-4000-8000-000000000001','role','authenticated')::text,
  true
);

do $$
declare
  v_valid boolean := false;
  v_stale boolean := false;
  v_removed boolean := false;
  v_forged boolean := false;
  v_nonboundary boolean := false;
  v_results text := '';
begin
  perform * from public.move_task(
    '60040000-0000-4000-8000-000000000033', 'Setup', 'To Do', 'To Do',
    null, '60040000-0000-4000-8000-000000000031'
  );
  select array_agg(t.id order by t.sort_order, t.id) = array[
    '60040000-0000-4000-8000-000000000033'::uuid,
    '60040000-0000-4000-8000-000000000031'::uuid,
    '60040000-0000-4000-8000-000000000032'::uuid
  ]
  into v_valid
  from public.tasks t
  where t.event_id = '60040000-0000-4000-8000-000000000020'
    and t.phase = 'Setup' and t.status = 'To Do';

  begin
    perform * from public.move_task(
      '60040000-0000-4000-8000-000000000032', 'Setup', 'In Progress', 'Completed', null, null
    );
  exception when sqlstate '40001' then v_stale := true;
  end;

  begin
    perform * from public.move_task(
      '60040000-0000-4000-8000-000000000032', 'Setup', 'To Do', 'To Do',
      '60040000-0000-4000-8000-000000000035', null
    );
  exception when sqlstate '40001' then v_removed := true;
  end;

  begin
    perform * from public.move_task(
      '60040000-0000-4000-8000-000000000032', 'Setup', 'To Do', 'To Do',
      '60040000-0000-4000-8000-000000000034', null
    );
  exception when sqlstate '40001' then v_forged := true;
  end;

  begin
    perform * from public.move_task(
      '60040000-0000-4000-8000-000000000031', 'Setup', 'To Do', 'To Do',
      null, '60040000-0000-4000-8000-000000000032'
    );
  exception when sqlstate '40001' then v_nonboundary := true;
  end;

  v_results := v_results || format(E'\nVALID_FIRST_BOUNDARY_MOVE: %s', case when v_valid then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nSTALE_EXPECTED_STATUS_40001: %s', case when v_stale then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nREMOVED_NEIGHBOR_40001: %s', case when v_removed then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nFORGED_CROSS_LANE_NEIGHBOR_40001: %s', case when v_forged then 'PASS' else 'FAIL' end);
  v_results := v_results || format(E'\nNONBOUNDARY_MISSING_NEIGHBOR_40001: %s', case when v_nonboundary then 'PASS' else 'FAIL' end);

  raise exception 'TEST RESULTS %', v_results;
end;
$$;
```

## Automated app tests

From the repository root run:

```text
npm test
npm run build
npm run lint
```

`src/lib/events/board-move.test.ts` covers the role matrix, complete-lane
neighbor calculation, empty/first/middle/last boundaries, tail-only status
moves, optimistic placement, SQLSTATE/message mapping, polling pause, and the
Undo state machine. The polling assertion specifically verifies that an
in-flight move or Undo changes the React Query interval from 15 seconds to
`false`. The component also disables focus refetch for the same busy period,
cancels existing board queries before optimistic mutation, and invalidates the
event-board query only on settlement before re-enabling automatic refetch.

## Manual checklist — Claudee (Admin) and tv (Member)

Use two separate browser profiles so Claudee and tv can remain signed in at
the same time. Test only on Dev.

### Prepare one Active event

1. As Claudee, open an Active event with one phase and at least three assigned
   cards in each status lane. Put tv on two cards and leave one card unassigned.
2. Include one task from Claudee's editable scope with an incomplete
   prerequisite. Include one non-confidential task not assigned to tv and one
   confidential task tv cannot open.
3. Keep the Admin committee and priority filters clear for drag tests.

### Pointer and permission checks

1. As Claudee on desktop, drag a card between two neighbors. Refresh: it stays
   between those neighbors.
2. As Claudee (Admin), reorder an assigned card in a lane with an unassigned
   (**Backlog**) task ranked between two assigned cards. The move succeeds with
   no stale-placement error.
3. Reorder a card to first and then last. Refresh after each move.
4. Drag a card to each other status lane. Confirm there is no delete target and
   no task disappears.
5. Turn on the Admin committee filter. Confirm drag handles stop working and
   the explanatory message appears; confirm the **Move to** control still works.
6. Turn on a priority filter that hides a card between two visible cards. Drag
   around the visible cards and confirm the result either persists or safely
   rejects/refetches; it must never force a stale neighbor placement.
7. As tv, drag an assigned card to another status. It must land at the true
   destination tail. Attempt a same-lane reorder; it must not move.
8. For every role, confirm Backlog cards have no **Move to** or circular
   **Complete** control and cannot be dragged. The masked confidential shell
   must also expose no move control.

### Keyboard and screen reader checks

1. Without a pointer, tab to **Move to** on an eligible card and move it
   forward, backward, and from Completed back to In Progress and To Do.
2. Use the desktop drag handle with the keyboard. Confirm dnd-kit's instructions
   are announced and Escape cancels without saving.
3. Confirm every drag handle, circular completion button, Move-to trigger,
   error, and Undo action has an understandable accessible name or announcement.
4. Confirm focus remains visible and the task-detail link still opens normally.

### Real-phone checks

1. On a real phone as tv, open the event board and tap the circular control on
   an assigned incomplete card. It becomes Completed and remains so after refresh.
2. Confirm the control has a comfortable touch target and that scrolling a card
   never starts a drag.
3. Tap the completion control on the dependency-blocked task. Confirm the card
   rolls back and displays: `Complete the prerequisite task before moving this task forward.`
4. Confirm no notification or unread indicator is created by either the failed
   or successful move.

### Polling, focus, and offline reconciliation

1. Keep Claudee and tv on the same event in separate visible windows. Move a
   card as Claudee; tv must converge within 15 seconds without a reload.
2. Move another card, switch tv's tab away and back, and confirm focus refetch
   converges immediately.
3. During Claudee's next move, rapidly switch focus and wait across a 15-second
   boundary. The optimistic order must not snap back while the request is
   pending: interval polling and focus refetch are paused until settlement,
   followed by one authoritative invalidation/refetch.
4. In browser Network settings choose Offline, attempt a move, and confirm the
   optimistic card rolls back with the offline message. Restore Online and use
   Retry/focus to confirm the server order.
5. Double-click/tap the same move control quickly. Only one RPC request may be
   in flight and controls remain disabled through reconciliation.

### Undo checks

1. Cross-lane: move a card and click Undo within about eight seconds. It returns
   to the previous lane's current tail through a normal `move_task` request.
2. Cross-lane expiry: move again, wait more than eight seconds, and confirm Undo
   disappears and cannot be invoked.
3. Same-lane middle: reorder a card from between two neighbors, then Undo. It
   returns between the retained previous and next neighbors.
4. Same-lane first and last: move the original first/last card, then Undo each.
   The missing previous/next neighbor restores the validated boundary.
5. Stale neighbor: after Claudee reorders a card, use tv's session or another
   Claudee window to move one retained neighbor before clicking Undo. Undo must
   fail clearly and refresh instead of forcing the old rank.
6. Removed neighbor: after creating an Undo opportunity, remove an eligible
   retained neighbor through Edit Event in the other window. Undo must fail and
   refresh.
7. Run SQL TEST 4 for forged, cross-lane, removed, and no-longer-boundary hints.
   These cases cannot be produced by the normal UI; the test proves the RPC
   rejects them with `40001`, while the UI's `40001` mapping is covered by
   Vitest and the stale-neighbor browser check.
